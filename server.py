"""
server.py - FastAPI Backend REST API for Expo Mobile Application.

Exposes AI background removal (RMBG-2.0 / rembg) and super-resolution upscaling (Real-ESRGAN x4)
over HTTP endpoints for React Native / Expo mobile app integration.
"""

import io
import os
import socket
import logging
from typing import Optional
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
import uvicorn

from utils import get_device, logger
from background_remover import BackgroundRemover
from upscaler import RealESRGANUpscaler

# Initialize FastAPI App
app = FastAPI(
    title="AI Image Studio API",
    description="REST API for RMBG-2.0 Background Removal and Real-ESRGAN Upscaling",
    version="1.0.0"
)

# Enable CORS for mobile app access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global AI Engine instances
bg_engine: Optional[BackgroundRemover] = None
upscale_engine: Optional[RealESRGANUpscaler] = None
device, device_str = get_device()


def get_local_ip() -> str:
    """Helper to detect local machine IP address on Wi-Fi/LAN."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.on_event("startup")
def startup_event():
    """Lazy initialize AI engines on server startup."""
    global bg_engine, upscale_engine
    logger.info("Initializing AI Mobile Backend Server...")
    local_ip = get_local_ip()
    logger.info(f"Server running locally at: http://localhost:8000")
    logger.info(f"Connect mobile app to: http://{local_ip}:8000")


@app.get("/")
def read_root():
    return {
        "status": "online",
        "app": "AI Image Studio API",
        "device": device_str,
        "endpoints": ["/health", "/api/process"]
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "device": device_str,
        "cuda_available": device.type == "cuda"
    }


@app.post("/api/process")
def process_image(
    file: UploadFile = File(...),
    remove_bg: bool = Form(True),
    upscale: bool = Form(True),
    scale_factor: int = Form(4)
):
    """
    Main image processing endpoint for Expo Mobile App.

    Accepts an uploaded image file and returns the processed transparent PNG image.
    """
    global bg_engine, upscale_engine

    if not remove_bg and not upscale:
        raise HTTPException(status_code=400, detail="At least one feature (remove_bg or upscale) must be enabled.")

    try:
        # Read uploaded file into PIL Image synchronously
        contents = file.file.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGBA")

        logger.info(f"Received mobile image: {file.filename} ({pil_image.width}x{pil_image.height})")

        # 1. Background Removal
        if remove_bg:
            if bg_engine is None:
                logger.info("Loading Background Removal Engine...")
                bg_engine = BackgroundRemover()
                bg_engine.initialize()
            
            logger.info("Executing Background Removal...")
            pil_image = bg_engine.process(pil_image)

        # 2. Image Upscaling
        if upscale:
            if upscale_engine is None:
                logger.info("Loading Real-ESRGAN Upscaler Engine...")
                upscale_engine = RealESRGANUpscaler()
                upscale_engine.load_model()
            
            logger.info(f"Executing Real-ESRGAN Upscaling ({scale_factor}x)...")
            pil_image = upscale_engine.upscale(pil_image, scale_factor=scale_factor)

        # Output bytes buffer as PNG
        img_byte_arr = io.BytesIO()
        pil_image.save(img_byte_arr, format="PNG")
        img_bytes = img_byte_arr.getvalue()

        logger.info(f"Successfully processed image for mobile client ({pil_image.width}x{pil_image.height})")

        return Response(content=img_bytes, media_type="image/png")

    except Exception as e:
        logger.error(f"Error processing mobile image request: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    local_ip = get_local_ip()
    print(f"\n=======================================================")
    print(f"AI Image Studio FastAPI Server Starting!")
    print(f"Connect your Expo Mobile App to: http://{local_ip}:8000")
    print(f"=======================================================\n")
    uvicorn.run(app, host="0.0.0.0", port=8000)
