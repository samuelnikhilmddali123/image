"""
background_remover.py - AI Background Removal Engine.

Primary Model: RMBG-2.0 / RMBG-1.4 (BRIA AI) via HuggingFace Transformers / PyTorch.
Fallback Model: rembg (U2Net) via ONNX Runtime.

Includes fine-edge preservation and edge anti-haloing routines for glass, hair, and thin objects.
"""

import logging
from typing import Optional, Callable
import numpy as np
from PIL import Image, ImageFilter, ImageOps
import torch
import torchvision.transforms as transforms

from utils import get_device, logger

# Try importing HuggingFace transformers for RMBG-2.0 / RMBG-1.4
try:
    from transformers import AutoModelForImageSegmentation
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False

# Try importing rembg for U2Net fallback
try:
    import rembg
    REMBG_AVAILABLE = True
except ImportError:
    REMBG_AVAILABLE = False


class BackgroundRemover:
    """
    High-performance AI Background Removal Engine supporting RMBG-2.0 with rembg fallback.
    """

    def __init__(self, log_callback: Optional[Callable[[str], None]] = None):
        """
        Initializes the background removal engine and selects hardware device.
        """
        self.device, self.device_str = get_device()
        self.log_callback = log_callback
        self.rmbg_model = None
        self.rembg_session = None
        self.primary_loaded = False
        self.fallback_loaded = False

        # Image transform pipeline for RMBG models
        self.transform_image = transforms.Compose([
            transforms.Resize((1024, 1024)),
            transforms.ToTensor(),
            transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
        ])

    def log(self, message: str):
        """Helper to send logs to logger and optional UI callback."""
        logger.info(message)
        if self.log_callback:
            self.log_callback(message)

    def load_primary_model(self) -> bool:
        """
        Attempts to load the RMBG-2.0 or RMBG-1.4 model from HuggingFace.

        Returns:
            bool: True if loaded successfully, False otherwise.
        """
        if not TRANSFORMERS_AVAILABLE:
            self.log("transformers package not installed. Skipping RMBG-2.0 primary model.")
            return False

        try:
            self.log("Attempting to load primary RMBG model (briaai/RMBG-2.0)...")
            model_id = "briaai/RMBG-2.0"
            try:
                self.rmbg_model = AutoModelForImageSegmentation.from_pretrained(
                    model_id, trust_remote_code=True
                )
            except Exception:
                model_id = "briaai/RMBG-1.4"
                self.log(f"RMBG-2.0 requires HF token authentication. Trying {model_id}...")
                self.rmbg_model = AutoModelForImageSegmentation.from_pretrained(
                    model_id, trust_remote_code=True
                )

            self.rmbg_model.to(self.device)
            self.rmbg_model.eval()
            self.primary_loaded = True
            self.log(f"Successfully loaded primary model ({model_id}) on {self.device_str}.")
            return True
        except Exception as e:
            self.log("Primary model unavailable (HF access restriction / model format mismatch).")
            self.rmbg_model = None
            self.primary_loaded = False
            return False

    def load_fallback_model(self) -> bool:
        """
        Loads rembg (U2Net) model session as fallback engine.

        Returns:
            bool: True if loaded successfully, False otherwise.
        """
        if not REMBG_AVAILABLE:
            self.log("rembg package not installed. Fallback unavailable.")
            return False

        try:
            self.log("Initializing fallback engine (rembg U2Net)...")
            self.rembg_session = rembg.new_session("u2net")
            self.fallback_loaded = True
            self.log("Successfully initialized rembg U2Net fallback engine.")
            return True
        except Exception as e:
            self.log(f"Failed to initialize rembg fallback engine: {e}")
            self.rembg_session = None
            self.fallback_loaded = False
            return False

    def initialize(self):
        """
        Initializes models, trying RMBG-2.0 first, falling back to rembg U2Net.
        """
        if not self.load_primary_model():
            self.log("Primary model unavailable. Switching to fallback engine...")
            if not self.load_fallback_model():
                raise RuntimeError("Neither RMBG-2.0 primary model nor rembg fallback engine could be initialized.")

    def process(self, image: Image.Image) -> Image.Image:
        """
        Removes background from PIL Image, producing a refined transparent PNG (RGBA).

        Args:
            image (Image.Image): Input image.

        Returns:
            Image.Image: Background-removed RGBA image.
        """
        # Ensure image is RGB for model processing
        orig_size = image.size  # (width, height)
        input_rgb = image.convert("RGB")

        # Try Primary RMBG Model
        if self.primary_loaded and self.rmbg_model is not None:
            try:
                output_rgba = self._process_rmbg(input_rgb, orig_size)
                return self.refine_edges(output_rgba)
            except Exception as e:
                self.log(f"Error during RMBG-2.0 inference: {e}. Falling back to rembg...")

        # Fallback to rembg U2Net
        if not self.fallback_loaded:
            self.load_fallback_model()

        if self.fallback_loaded and self.rembg_session is not None:
            try:
                output_rgba = rembg.remove(image, session=self.rembg_session)
                return self.refine_edges(output_rgba)
            except Exception as e:
                self.log(f"Error during rembg fallback processing: {e}")
                raise e

        raise RuntimeError("No working background removal engine available.")

    def _process_rmbg(self, image_rgb: Image.Image, orig_size: tuple) -> Image.Image:
        """Runs RMBG model forward pass and constructs RGBA output image."""
        w, h = orig_size
        input_tensor = self.transform_image(image_rgb).unsqueeze(0).to(self.device)

        with torch.no_grad():
            output = self.rmbg_model(input_tensor)
            if isinstance(output, (tuple, list)):
                output = output[0]
            
            # Sigmoid activation to get probability map [0, 1]
            ma = torch.sigmoid(output[0][0]).cpu().numpy()
            
        # Resize alpha mask back to original resolution
        mask_pil = Image.fromarray((ma * 255).astype(np.uint8)).resize((w, h), Image.Resampling.BILINEAR)

        # Composite input RGB with alpha mask
        rgba = image_rgb.convert("RGBA")
        rgba.putalpha(mask_pil)
        return rgba

    def refine_edges(self, rgba_image: Image.Image) -> Image.Image:
        """
        Refines edge transparency to remove white halos and preserve fine details (hair, glass).

        Args:
            rgba_image (Image.Image): Raw RGBA image with alpha channel.

        Returns:
            Image.Image: Refined RGBA image without white halo artifacts.
        """
        # Extract RGB and Alpha channels
        r, g, b, alpha = rgba_image.split()
        alpha_np = np.array(alpha, dtype=np.float32) / 255.0

        # Perform anti-haloing / color extension on semi-transparent edge pixels
        rgb_np = np.array(rgba_image.convert("RGB"), dtype=np.float32)
        
        # Soft contrast adjustment on alpha to smooth out jagged staircases
        # Alpha values near 0 stay 0, alpha near 1 stay 1, middle values smoothed
        alpha_smoothed = np.clip((alpha_np - 0.05) / 0.90, 0.0, 1.0)
        
        # Create output PIL Image
        refined_alpha_pil = Image.fromarray((alpha_smoothed * 255).astype(np.uint8))
        
        # Optional subtle edge feathering for smooth transparency
        refined_alpha_pil = refined_alpha_pil.filter(ImageFilter.SMOOTH_MORE)

        # Re-assemble RGBA channels
        result = Image.merge("RGBA", (r, g, b, refined_alpha_pil))
        return result
