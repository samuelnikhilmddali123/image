"""
upscaler.py - Real-ESRGAN Image Upscaling Module.

Provides AI-powered x4 and x2 super-resolution upscaling using the Real-ESRGAN RRDBNet architecture.
Supports CUDA GPU and CPU execution with tile-based processing to prevent OOM errors.
Preserves original colors, fine textures, and transparency channels.
"""

import os
import math
import logging
from typing import Optional, Callable
import numpy as np
from PIL import Image
import torch
import torch.nn as nn
import torch.nn.functional as F

from utils import get_device, ensure_models_directory, download_file, logger

# Official Real-ESRGAN x4plus model URL
REAL_ESRGAN_X4_URL = "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
MODEL_FILENAME = "RealESRGAN_x4plus.pth"


class ResidualDenseBlock_5C(nn.Module):
    """5-convolution Residual Dense Block for RRDBNet."""

    def __init__(self, nf: int = 64, gc: int = 32, bias: bool = True):
        super(ResidualDenseBlock_5C, self).__init__()
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1, bias=bias)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1, bias=bias)
        self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1, bias=bias)
        self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1, bias=bias)
        self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1, bias=bias)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    """Residual in Residual Dense Block."""

    def __init__(self, nf: int, gc: int = 32):
        super(RRDB, self).__init__()
        self.rdb1 = ResidualDenseBlock_5C(nf, gc)
        self.rdb2 = ResidualDenseBlock_5C(nf, gc)
        self.rdb3 = ResidualDenseBlock_5C(nf, gc)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x


class RRDBNet(nn.Module):
    """
    Real-ESRGAN RRDBNet network structure for 4x super-resolution.
    """

    def __init__(
        self,
        num_in_ch: int = 3,
        num_out_ch: int = 3,
        num_feat: int = 64,
        num_block: int = 23,
        num_grow_ch: int = 32,
        scale: int = 4
    ):
        super(RRDBNet, self).__init__()
        self.scale = scale
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1, bias=True)
        self.body = nn.Sequential(*[RRDB(nf=num_feat, gc=num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        # Upsampling layers
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1, bias=True)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1, bias=True)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        feat = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat = feat + body_feat

        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        out = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out


class RealESRGANUpscaler:
    """
    Upscaler class wrapping Real-ESRGAN model inference with support for tiling,
    2x/4x scaling, and RGBA transparency preservation.
    """

    def __init__(
        self,
        tile_size: int = 512,
        tile_pad: int = 10,
        log_callback: Optional[Callable[[str], None]] = None
    ):
        """
        Initializes the Real-ESRGAN Upscaler.

        Args:
            tile_size (int): Tile size for memory-efficient processing.
            tile_pad (int): Tile padding overlap to eliminate seam artifacts.
            log_callback (Optional[Callable[[str], None]]): Log handler callback.
        """
        self.device, self.device_str = get_device()
        self.tile_size = tile_size
        self.tile_pad = tile_pad
        self.log_callback = log_callback
        self.model: Optional[RRDBNet] = None
        self.is_loaded = False

    def log(self, message: str):
        """Send logs to logger and callback."""
        logger.info(message)
        if self.log_callback:
            self.log_callback(message)

    def load_model(self, progress_callback: Optional[Callable[[int, int], None]] = None) -> bool:
        """
        Ensures model weights are downloaded and loads model parameters onto device.

        Returns:
            bool: True if loaded successfully, False otherwise.
        """
        try:
            models_dir = ensure_models_directory()
            weights_path = os.path.join(models_dir, MODEL_FILENAME)

            if not os.path.exists(weights_path):
                self.log("Downloading Real-ESRGAN x4plus model weights...")
                download_file(REAL_ESRGAN_X4_URL, weights_path, progress_callback)

            self.log(f"Loading Real-ESRGAN model onto {self.device_str}...")
            model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
            
            # Load state dict
            checkpoint = torch.load(weights_path, map_location=self.device)
            if "params_ema" in checkpoint:
                keyname = "params_ema"
            elif "params" in checkpoint:
                keyname = "params"
            else:
                keyname = None

            state_dict = checkpoint[keyname] if keyname else checkpoint
            model.load_state_dict(state_dict, strict=True)
            model.to(self.device)
            model.eval()

            self.model = model
            self.is_loaded = True
            self.log("Real-ESRGAN upscaler loaded successfully.")
            return True
        except Exception as e:
            self.log(f"Failed to load Real-ESRGAN model: {e}")
            self.model = None
            self.is_loaded = False
            return False

    def upscale(self, image: Image.Image, scale_factor: int = 4) -> Image.Image:
        """
        Upscales an image using Real-ESRGAN model.

        Args:
            image (Image.Image): Input PIL Image (RGB or RGBA).
            scale_factor (int): Desired target upscale factor (2 or 4).

        Returns:
            Image.Image: Upscaled PIL Image.
        """
        if not self.is_loaded or self.model is None:
            if not self.load_model():
                raise RuntimeError("Real-ESRGAN model is not loaded.")

        has_alpha = image.mode == "RGBA"
        
        # CPU optimization: if running on CPU and the image is large (> 800x800),
        # running 35+ tiles takes 30+ minutes which times out the mobile app.
        # We fallback to a high-speed Lanczos4 + UnsharpMask filter which runs in < 0.5s.
        if self.device.type == "cpu" and (image.width * image.height) > (800 * 800):
            self.log(f" -> Large image ({image.width}x{image.height}) detected on CPU. Using high-speed upscaling fallback...")
            from PIL import ImageFilter
            target_w = image.width * scale_factor
            target_h = image.height * scale_factor
            
            # Upscale RGB and Alpha cleanly
            upscaled = image.resize((target_w, target_h), Image.Resampling.LANCZOS)
            # Apply sharpening to restore texture details
            sharpened = upscaled.filter(ImageFilter.UnsharpMask(radius=1.5, percent=100, threshold=2))
            self.log(" -> Upscaling completed successfully (CPU optimized).")
            return sharpened

        if has_alpha:
            r, g, b, alpha = image.split()
            rgb_image = Image.merge("RGB", (r, g, b))
        else:
            rgb_image = image.convert("RGB")
            alpha = None

        # Perform 4x model super-resolution inference
        sr_rgb = self._upscale_rgb_tiled(rgb_image)

        # Handle target scale factor (if 2x requested, downsample the 4x result smoothly)
        target_w = rgb_image.width * scale_factor
        target_h = rgb_image.height * scale_factor

        if scale_factor != 4:
            sr_rgb = sr_rgb.resize((target_w, target_h), Image.Resampling.LANCZOS)

        # Handle alpha channel scaling if transparent
        if has_alpha and alpha is not None:
            sr_alpha = alpha.resize((target_w, target_h), Image.Resampling.LANCZOS)
            sr_rgba = Image.merge("RGBA", (sr_rgb.r, sr_rgb.g, sr_rgb.b, sr_alpha))
            return sr_rgba

        return sr_rgb

    def _upscale_rgb_tiled(self, img_rgb: Image.Image) -> Image.Image:
        """
        Processes RGB image in tiles to prevent OOM errors on large images or limited VRAM.
        """
        img_np = np.array(img_rgb, dtype=np.float32) / 255.0
        # Convert HWC to CHW tensor
        img_tensor = torch.from_numpy(np.transpose(img_np, (2, 0, 1))).unsqueeze(0).to(self.device)

        # Enable PyTorch multi-threading on CPU for maximum performance
        if self.device.type == "cpu":
            num_cores = os.cpu_count() or 4
            torch.set_num_threads(num_cores)

        batch, channel, height, width = img_tensor.shape
        output_height = height * 4
        output_width = width * 4

        output_tensor = torch.zeros((batch, channel, output_height, output_width), device=self.device)

        tiles_x = math.ceil(width / self.tile_size)
        tiles_y = math.ceil(height / self.tile_size)
        total_tiles = tiles_x * tiles_y
        current_tile = 0

        self.log(f" -> Upscaling image ({width}x{height}) in {total_tiles} tile(s)...")

        with torch.inference_mode():
            for y in range(tiles_y):
                for x in range(tiles_x):
                    current_tile += 1
                    percent = int((current_tile / total_tiles) * 100)
                    self.log(f"   - Tile {current_tile}/{total_tiles} ({percent}%)...")

                    # Input tile bounding box with padding
                    x_start = x * self.tile_size
                    x_end = min(x_start + self.tile_size, width)
                    y_start = y * self.tile_size
                    y_end = min(y_start + self.tile_size, height)

                    x_start_pad = max(x_start - self.tile_pad, 0)
                    x_end_pad = min(x_end + self.tile_pad, width)
                    y_start_pad = max(y_start - self.tile_pad, 0)
                    y_end_pad = min(y_end + self.tile_pad, height)

                    # Crop tile tensor
                    tile = img_tensor[:, :, y_start_pad:y_end_pad, x_start_pad:x_end_pad]

                    # Model forward pass
                    tile_output = self.model(tile)

                    # Crop padding out of output tile
                    out_x_start = (x_start - x_start_pad) * 4
                    out_x_end = out_x_start + (x_end - x_start) * 4
                    out_y_start = (y_start - y_start_pad) * 4
                    out_y_end = out_y_start + (y_end - y_start) * 4

                    tile_output_cropped = tile_output[:, :, out_y_start:out_y_end, out_x_start:out_x_end]

                    # Paste into output tensor
                    output_tensor[:, :, y_start*4:y_end*4, x_start*4:x_end*4] = tile_output_cropped

        self.log(" -> Upscaling completed successfully!")

        # Convert back to PIL Image
        out_np = output_tensor.squeeze(0).cpu().numpy()
        out_np = np.clip(np.transpose(out_np, (1, 2, 0)) * 255.0, 0, 255).astype(np.uint8)
        return Image.fromarray(out_np)
