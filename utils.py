"""
utils.py - Utility Module for AI Image Processing Application.

Provides device detection (CUDA/CPU), model path resolution, file I/O helpers,
downloader utilities, and image conversion routines.
"""

import os
import sys
import logging
import urllib.request
from typing import Tuple, List, Optional, Callable
from PIL import Image, ImageOps
import torch

# Configure logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("AIImageApp")

# Supported image file extensions
SUPPORTED_EXTENSIONS: Tuple[str, ...] = (
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"
)

# Default model directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")


def get_device() -> Tuple[torch.device, str]:
    """
    Detects hardware capabilities and returns the optimal PyTorch device and name.

    Returns:
        Tuple[torch.device, str]: PyTorch device instance and human-readable device name.
    """
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        device = torch.device("cuda")
        device_str = f"CUDA GPU ({gpu_name})"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = torch.device("mps")
        device_str = "Apple Silicon (MPS)"
    else:
        device = torch.device("cpu")
        device_str = "CPU"
    
    logger.info(f"Execution Device: {device_str}")
    return device, device_str


def ensure_models_directory() -> str:
    """
    Ensures that the models directory exists locally.

    Returns:
        str: Absolute path to the models directory.
    """
    if not os.path.exists(MODELS_DIR):
        os.makedirs(MODELS_DIR, exist_ok=True)
        logger.info(f"Created models directory: {MODELS_DIR}")
    return MODELS_DIR


def is_supported_image(filepath: str) -> bool:
    """
    Checks if a given file path is a supported image format.

    Args:
        filepath (str): Path to the file.

    Returns:
        bool: True if supported image format, False otherwise.
    """
    if not os.path.isfile(filepath):
        return False
    ext = os.path.splitext(filepath)[1].lower()
    return ext in SUPPORTED_EXTENSIONS


def get_image_files_from_folder(folder_path: str) -> List[str]:
    """
    Scans a folder recursively or flatly and collects all supported image files.

    Args:
        folder_path (str): Path to directory.

    Returns:
        List[str]: List of absolute file paths for supported images.
    """
    valid_files: List[str] = []
    if not os.path.isdir(folder_path):
        return valid_files

    for root, _, files in os.walk(folder_path):
        for f in files:
            full_path = os.path.join(root, f)
            if is_supported_image(full_path):
                valid_files.append(full_path)
    
    valid_files.sort()
    return valid_files


def download_file(
    url: str,
    dest_path: str,
    progress_callback: Optional[Callable[[int, int], None]] = None
) -> str:
    """
    Downloads a file from a URL to a local destination path with progress callbacks.

    Args:
        url (str): Source HTTP/HTTPS URL.
        dest_path (str): Destination path on disk.
        progress_callback (Optional[Callable[[int, int], None]]): Callback function receiving (downloaded_bytes, total_bytes).

    Returns:
        str: Path to the downloaded file.
    """
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        logger.info(f"Model file already exists: {dest_path}")
        return dest_path

    logger.info(f"Downloading model from {url} to {dest_path}...")
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    
    temp_path = dest_path + ".tmp"
    
    try:
        def handle_progress(block_num, block_size, total_size):
            downloaded = block_num * block_size
            if progress_callback:
                progress_callback(min(downloaded, total_size), total_size)

        urllib.request.urlretrieve(url, temp_path, reporthook=handle_progress)
        os.rename(temp_path, dest_path)
        logger.info(f"Successfully downloaded model to {dest_path}")
        return dest_path
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        logger.error(f"Failed to download file from {url}: {e}")
        raise e


def load_pil_image(image_path: str) -> Image.Image:
    """
    Loads an image from disk using PIL and corrects orientation based on EXIF tags.

    Args:
        image_path (str): Path to image file.

    Returns:
        Image.Image: Loaded PIL Image in RGBA or RGB format.
    """
    try:
        img = Image.open(image_path)
        img = ImageOps.exif_transpose(img)
        # Ensure image mode is convertible to RGBA
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
        return img
    except Exception as e:
        logger.error(f"Error loading image {image_path}: {e}")
        raise e


def save_pil_image(image: Image.Image, output_path: str) -> str:
    """
    Saves a PIL Image to disk, ensuring directory existence and proper format output.

    Args:
        image (Image.Image): PIL Image object.
        output_path (str): Output destination filepath.

    Returns:
        str: Saved output path.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    ext = os.path.splitext(output_path)[1].lower()

    if ext == ".png":
        # PNG supports RGBA transparency
        image.save(output_path, format="PNG", optimize=True)
    elif ext in (".jpg", ".jpeg"):
        # JPEG doesn't support alpha channel; composite over white background if RGBA
        if image.mode == "RGBA":
            background = Image.new("RGB", image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])
            background.save(output_path, format="JPEG", quality=95)
        else:
            image.convert("RGB").save(output_path, format="JPEG", quality=95)
    elif ext == ".webp":
        image.save(output_path, format="WEBP", quality=95)
    else:
        # Default to PNG format if extension is unrecognized or missing
        image.save(output_path, format="PNG")
    
    logger.info(f"Image saved successfully to {output_path}")
    return output_path
