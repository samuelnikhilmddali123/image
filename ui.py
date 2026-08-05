"""
ui.py - CustomTkinter User Interface Module.

Implements a modern dark-mode GUI for single and batch AI image background removal
and super-resolution upscaling, complete with real-time previews, logs, and progress tracking.
"""

import os
import queue
import threading
import time
from typing import Optional, List
from PIL import Image, ImageTk
import customtkinter as ctk
from tkinter import filedialog, messagebox

from utils import (
    get_device,
    is_supported_image,
    get_image_files_from_folder,
    load_pil_image,
    save_pil_image,
    logger
)
from background_remover import BackgroundRemover
from upscaler import RealESRGANUpscaler

# Configure CustomTkinter theme
ctk.set_appearance_mode("Dark")
ctk.set_default_color_theme("blue")


class AIImageAppUI(ctk.CTk):
    """
    Main CustomTkinter Window class orchestrating user input, worker threads,
    AI engine invocations, preview rendering, and log console updates.
    """

    def __init__(self):
        super().__init__()

        # Window properties
        self.title("AI Image Processor - RMBG-2.0 & Real-ESRGAN x4")
        self.geometry("1280x820")
        self.minsize(1024, 700)

        # Hardware detection
        self.device, self.device_str = get_device()

        # Application state variables
        self.mode_var = ctk.StringVar(value="Single")  # "Single" or "Batch"
        self.input_path_var = ctk.StringVar()
        self.output_path_var = ctk.StringVar()
        self.bg_remove_var = ctk.BooleanVar(value=True)
        self.upscale_var = ctk.BooleanVar(value=True)
        self.scale_factor_var = ctk.StringVar(value="4x")

        # Worker thread control
        self.is_processing = False
        self.cancel_requested = False
        self.work_thread: Optional[threading.Thread] = None
        self.log_queue: queue.Queue = queue.Queue()

        # Preview image cache
        self.original_pil: Optional[Image.Image] = None
        self.processed_pil: Optional[Image.Image] = None

        # AI Model Engine Instances
        self.bg_engine: Optional[BackgroundRemover] = None
        self.upscale_engine: Optional[RealESRGANUpscaler] = None

        # Construct User Interface Layout
        self._build_ui()

        # Start periodic log queue consumer loop
        self.after(100, self._process_log_queue)

    def _build_ui(self):
        """Constructs sidebar controls, preview cards, progress bar, and log text console."""
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        # ----------------------------------------------------
        # LEFT SIDEBAR - Controls & Settings
        # ----------------------------------------------------
        self.sidebar = ctk.CTkFrame(self, width=320, corner_radius=12)
        self.sidebar.grid(row=0, column=0, padx=15, pady=15, sticky="nsew")
        self.sidebar.grid_columnconfigure(0, weight=1)

        # Header Title
        title_label = ctk.CTkLabel(
            self.sidebar,
            text="✨ AI Image Studio",
            font=ctk.CTkFont(size=22, weight="bold")
        )
        title_label.grid(row=0, column=0, padx=20, pady=(20, 5), sticky="w")

        # Device Badge
        device_badge = ctk.CTkLabel(
            self.sidebar,
            text=f"⚡ Device: {self.device_str}",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color="#3B82F6" if "CUDA" in self.device_str else "#10B981"
        )
        device_badge.grid(row=1, column=0, padx=20, pady=(0, 15), sticky="w")

        # Processing Mode (Single / Batch)
        mode_label = ctk.CTkLabel(self.sidebar, text="Processing Mode:", font=ctk.CTkFont(weight="bold"))
        mode_label.grid(row=2, column=0, padx=20, pady=(10, 5), sticky="w")

        mode_segment = ctk.CTkSegmentedButton(
            self.sidebar,
            values=["Single Image", "Batch Folder"],
            command=self._on_mode_change
        )
        mode_segment.set("Single Image")
        mode_segment.grid(row=3, column=0, padx=20, pady=(0, 15), sticky="ew")

        # Input Selection Frame
        self.input_label = ctk.CTkLabel(self.sidebar, text="Input File:", font=ctk.CTkFont(weight="bold"))
        self.input_label.grid(row=4, column=0, padx=20, pady=(5, 2), sticky="w")

        input_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        input_frame.grid(row=5, column=0, padx=20, pady=(0, 15), sticky="ew")
        input_frame.grid_columnconfigure(0, weight=1)

        self.input_entry = ctk.CTkEntry(input_frame, textvariable=self.input_path_var, placeholder_text="Select input image...")
        self.input_entry.grid(row=0, column=0, padx=(0, 8), sticky="ew")

        btn_browse_input = ctk.CTkButton(input_frame, text="Browse", width=70, command=self._browse_input)
        btn_browse_input.grid(row=0, column=1)

        # Output Selection Frame
        output_label = ctk.CTkLabel(self.sidebar, text="Output Directory:", font=ctk.CTkFont(weight="bold"))
        output_label.grid(row=6, column=0, padx=20, pady=(5, 2), sticky="w")

        output_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        output_frame.grid(row=7, column=0, padx=20, pady=(0, 20), sticky="ew")
        output_frame.grid_columnconfigure(0, weight=1)

        self.output_entry = ctk.CTkEntry(output_frame, textvariable=self.output_path_var, placeholder_text="Select output folder...")
        self.output_entry.grid(row=0, column=0, padx=(0, 8), sticky="ew")

        btn_browse_output = ctk.CTkButton(output_frame, text="Browse", width=70, command=self._browse_output)
        btn_browse_output.grid(row=0, column=1)

        # Separator Line
        sep1 = ctk.CTkFrame(self.sidebar, height=2, fg_color="#334155")
        sep1.grid(row=8, column=0, padx=20, pady=10, sticky="ew")

        # Feature Checkboxes & Options
        options_label = ctk.CTkLabel(self.sidebar, text="AI Features:", font=ctk.CTkFont(weight="bold"))
        options_label.grid(row=9, column=0, padx=20, pady=(5, 5), sticky="w")

        chk_bg = ctk.CTkCheckBox(self.sidebar, text="Remove Background (RMBG-2.0)", variable=self.bg_remove_var)
        chk_bg.grid(row=10, column=0, padx=20, pady=6, sticky="w")

        chk_upscale = ctk.CTkCheckBox(self.sidebar, text="Enable Upscaling (Real-ESRGAN)", variable=self.upscale_var)
        chk_upscale.grid(row=11, column=0, padx=20, pady=6, sticky="w")

        scale_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        scale_frame.grid(row=12, column=0, padx=20, pady=(6, 20), sticky="w")

        scale_lbl = ctk.CTkLabel(scale_frame, text="Upscale Factor:")
        scale_lbl.pack(side="left", padx=(0, 10))

        r_2x = ctk.CTkRadioButton(scale_frame, text="2x", variable=self.scale_factor_var, value="2x")
        r_2x.pack(side="left", padx=5)

        r_4x = ctk.CTkRadioButton(scale_frame, text="4x", variable=self.scale_factor_var, value="4x")
        r_4x.pack(side="left", padx=5)

        # Action Buttons
        self.btn_start = ctk.CTkButton(
            self.sidebar,
            text="🚀 Start Processing",
            font=ctk.CTkFont(size=15, weight="bold"),
            height=42,
            fg_color="#2563EB",
            hover_color="#1D4ED8",
            command=self._start_processing
        )
        self.btn_start.grid(row=13, column=0, padx=20, pady=(10, 8), sticky="ew")

        self.btn_cancel = ctk.CTkButton(
            self.sidebar,
            text="⏹ Cancel",
            font=ctk.CTkFont(size=14),
            height=36,
            fg_color="#DC2626",
            hover_color="#B91C1C",
            state="disabled",
            command=self._cancel_processing
        )
        self.btn_cancel.grid(row=14, column=0, padx=20, pady=(0, 20), sticky="ew")

        # ----------------------------------------------------
        # RIGHT MAIN AREA - Previews, Progress & Log Monitor
        # ----------------------------------------------------
        self.main_frame = ctk.CTkFrame(self, corner_radius=12)
        self.main_frame.grid(row=0, column=1, padx=(0, 15), pady=15, sticky="nsew")
        self.main_frame.grid_columnconfigure(0, weight=1)
        self.main_frame.grid_rowconfigure(0, weight=3)  # Previews take 3x space
        self.main_frame.grid_rowconfigure(1, weight=1)  # Logs & progress take 1x space

        # Previews Container (Side-by-Side Cards)
        preview_container = ctk.CTkFrame(self.main_frame, fg_color="transparent")
        preview_container.grid(row=0, column=0, padx=15, pady=15, sticky="nsew")
        preview_container.grid_columnconfigure((0, 1), weight=1)
        preview_container.grid_rowconfigure(0, weight=1)

        # Card 1: Original Image Preview
        orig_card = ctk.CTkFrame(preview_container, corner_radius=10)
        orig_card.grid(row=0, column=0, padx=(0, 8), pady=0, sticky="nsew")
        orig_card.grid_rowconfigure(1, weight=1)
        orig_card.grid_columnconfigure(0, weight=1)

        orig_header = ctk.CTkLabel(orig_card, text="Original Image", font=ctk.CTkFont(size=14, weight="bold"))
        orig_header.grid(row=0, column=0, padx=10, pady=10)

        self.lbl_preview_orig = ctk.CTkLabel(orig_card, text="No Image Selected", text_color="#64748B")
        self.lbl_preview_orig.grid(row=1, column=0, padx=10, pady=10, sticky="nsew")

        # Card 2: Processed Result Preview
        proc_card = ctk.CTkFrame(preview_container, corner_radius=10)
        proc_card.grid(row=0, column=1, padx=(8, 0), pady=0, sticky="nsew")
        proc_card.grid_rowconfigure(1, weight=1)
        proc_card.grid_columnconfigure(0, weight=1)

        proc_header = ctk.CTkLabel(proc_card, text="Processed Result", font=ctk.CTkFont(size=14, weight="bold"))
        proc_header.grid(row=0, column=0, padx=10, pady=10)

        self.lbl_preview_proc = ctk.CTkLabel(proc_card, text="Result will appear here", text_color="#64748B")
        self.lbl_preview_proc.grid(row=1, column=0, padx=10, pady=10, sticky="nsew")

        # Status, Progress & Log Box Container
        status_container = ctk.CTkFrame(self.main_frame, corner_radius=10)
        status_container.grid(row=1, column=0, padx=15, pady=(0, 15), sticky="nsew")
        status_container.grid_columnconfigure(0, weight=1)
        status_container.grid_rowconfigure(2, weight=1)

        # Progress bar & Status text
        self.lbl_status = ctk.CTkLabel(status_container, text="Ready", font=ctk.CTkFont(weight="bold"))
        self.lbl_status.grid(row=0, column=0, padx=15, pady=(10, 4), sticky="w")

        self.progress_bar = ctk.CTkProgressBar(status_container, height=12)
        self.progress_bar.set(0.0)
        self.progress_bar.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="ew")

        # Log Text Box Console
        self.log_textbox = ctk.CTkTextbox(status_container, font=ctk.CTkFont(family="Consolas", size=12))
        self.log_textbox.grid(row=2, column=0, padx=15, pady=(0, 10), sticky="nsew")
        self.log_textbox.configure(state="disabled")

    # ----------------------------------------------------
    # UI EVENT HANDLERS & CALLBACKS
    # ----------------------------------------------------
    def log_message(self, text: str):
        """Thread-safe logging helper pushing messages to Queue."""
        timestamp = time.strftime("%H:%M:%S")
        self.log_queue.put(f"[{timestamp}] {text}\n")

    def _process_log_queue(self):
        """Periodic GUI timer function pulling logs from Queue and appending to Textbox."""
        while not self.log_queue.empty():
            msg = self.log_queue.get_nowait()
            self.log_textbox.configure(state="normal")
            self.log_textbox.insert("end", msg)
            self.log_textbox.see("end")
            self.log_textbox.configure(state="disabled")
        self.after(100, self._process_log_queue)

    def _on_mode_change(self, mode: str):
        """Switches mode between Single Image and Batch Folder."""
        if mode == "Single Image":
            self.mode_var.set("Single")
            self.input_label.configure(text="Input Image File:")
        else:
            self.mode_var.set("Batch")
            self.input_label.configure(text="Input Directory:")

    def _browse_input(self):
        """Opens file or directory picker depending on selected mode."""
        if self.mode_var.get() == "Single":
            filepath = filedialog.askopenfilename(
                title="Select Image File",
                filetypes=[("Supported Images", "*.jpg *.jpeg *.png *.webp *.bmp *.tiff")]
            )
            if filepath:
                self.input_path_var.set(filepath)
                # Auto set default output path if empty
                if not self.output_path_var.get():
                    self.output_path_var.set(os.path.dirname(filepath))
                self._load_original_preview(filepath)
        else:
            folderpath = filedialog.askdirectory(title="Select Folder of Images")
            if folderpath:
                self.input_path_var.set(folderpath)
                if not self.output_path_var.get():
                    self.output_path_var.set(os.path.join(folderpath, "output"))

    def _browse_output(self):
        """Opens folder picker for output destination."""
        folderpath = filedialog.askdirectory(title="Select Output Directory")
        if folderpath:
            self.output_path_var.set(folderpath)

    def _load_original_preview(self, image_path: str):
        """Loads and renders thumbnail preview of original image."""
        try:
            pil_img = load_pil_image(image_path)
            self.original_pil = pil_img
            self._render_thumbnail(pil_img, self.lbl_preview_orig)
        except Exception as e:
            self.log_message(f"Error loading preview: {e}")

    def _render_thumbnail(self, pil_img: Image.Image, target_label: ctk.CTkLabel):
        """Resizes PIL image maintaining aspect ratio and displays on CTkLabel widget."""
        # Calculate bounding box (350x350 thumbnail)
        w, h = pil_img.size
        max_size = 350
        scale = min(max_size / w, max_size / h, 1.0)
        thumb_w = int(w * scale)
        thumb_h = int(h * scale)

        resized = pil_img.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        ctk_img = ctk.CTkImage(light_image=resized, dark_image=resized, size=(thumb_w, thumb_h))
        target_label.configure(image=ctk_img, text="")

    # ----------------------------------------------------
    # WORKER THREAD & EXECUTION ENGINE
    # ----------------------------------------------------
    def _start_processing(self):
        """Validates inputs and launches non-blocking worker thread."""
        input_path = self.input_path_var.get().strip()
        output_path = self.output_path_var.get().strip()

        if not input_path or not os.path.exists(input_path):
            messagebox.showerror("Error", "Please select a valid input file or directory.")
            return

        if not output_path:
            messagebox.showerror("Error", "Please select an output directory.")
            return

        if not self.bg_remove_var.get() and not self.upscale_var.get():
            messagebox.showwarning("Warning", "Please enable at least one AI feature (Background Removal or Upscaling).")
            return

        # Disable Controls
        self.is_processing = True
        self.cancel_requested = False
        self.btn_start.configure(state="disabled")
        self.btn_cancel.configure(state="normal")
        self.progress_bar.set(0.0)

        # Launch Worker Thread
        self.work_thread = threading.Thread(
            target=self._worker_routine,
            args=(input_path, output_path),
            daemon=True
        )
        self.work_thread.start()

    def _cancel_processing(self):
        """Requests cancellation of ongoing batch processing."""
        if self.is_processing:
            self.cancel_requested = True
            self.log_message("Cancellation requested by user... Stopping after current step.")

    def _worker_routine(self, input_path: str, output_path: str):
        """
        Background worker thread executing background removal and upscaling models.
        """
        try:
            self.log_message("Initializing AI Engines...")
            self.lbl_status.configure(text="Initializing AI Models...")

            # Initialize Background Removal Engine if enabled
            if self.bg_remove_var.get():
                if self.bg_engine is None:
                    self.bg_engine = BackgroundRemover(log_callback=self.log_message)
                    self.bg_engine.initialize()

            # Initialize Upscaler Engine if enabled
            if self.upscale_var.get():
                if self.upscale_engine is None:
                    self.upscale_engine = RealESRGANUpscaler(log_callback=self.log_message)
                    self.upscale_engine.load_model()

            # Determine list of target image files
            if self.mode_var.get() == "Single":
                image_files = [input_path]
            else:
                image_files = get_image_files_from_folder(input_path)

            total_files = len(image_files)
            if total_files == 0:
                self.log_message("No supported images found to process.")
                self._finish_processing("No images found.")
                return

            self.log_message(f"Starting batch processing of {total_files} image(s)...")

            scale_factor = 2 if self.scale_factor_var.get() == "2x" else 4

            for idx, img_file in enumerate(image_files, 1):
                if self.cancel_requested:
                    self.log_message("Processing cancelled.")
                    break

                self.log_message(f"\n[{idx}/{total_files}] Processing: {os.path.basename(img_file)}")
                self.lbl_status.configure(text=f"Processing [{idx}/{total_files}]: {os.path.basename(img_file)}")
                self.progress_bar.set((idx - 1) / total_files)

                try:
                    # 1. Load image
                    pil_img = load_pil_image(img_file)
                    
                    # Update preview if single image or first image
                    if self.mode_var.get() == "Single":
                        self.after(0, lambda p=pil_img: self._render_thumbnail(p, self.lbl_preview_orig))

                    processed_img = pil_img

                    # 2. Background Removal
                    if self.bg_remove_var.get() and self.bg_engine:
                        self.log_message(" -> Removing background...")
                        processed_img = self.bg_engine.process(processed_img)

                    # 3. Image Upscaling
                    if self.upscale_var.get() and self.upscale_engine:
                        self.log_message(f" -> Upscaling ({scale_factor}x)...")
                        processed_img = self.upscale_engine.upscale(processed_img, scale_factor=scale_factor)

                    # 4. Construct Output Path & Save
                    filename = os.path.basename(img_file)
                    name_without_ext = os.path.splitext(filename)[0]

                    # If background removal enabled, save as PNG for transparency
                    if self.bg_remove_var.get():
                        out_filename = f"{name_without_ext}_processed.png"
                    else:
                        out_filename = f"{name_without_ext}_processed{os.path.splitext(filename)[1]}"

                    out_full_path = os.path.join(output_path, out_filename)
                    save_pil_image(processed_img, out_full_path)

                    # Update Processed Preview
                    self.processed_pil = processed_img
                    self.after(0, lambda p=processed_img: self._render_thumbnail(p, self.lbl_preview_proc))

                    self.log_message(f" -> Success! Output: {out_filename}")

                except Exception as file_err:
                    self.log_message(f" ❌ Failed to process {os.path.basename(img_file)}: {file_err}")
                    # Continue batch processing even if one image fails!

                self.progress_bar.set(idx / total_files)

            status_msg = "Completed successfully!" if not self.cancel_requested else "Cancelled by user."
            self._finish_processing(status_msg)

        except Exception as e:
            self.log_message(f"❌ Unhandled Error in processing thread: {e}")
            self._finish_processing("Error occurred.")

    def _finish_processing(self, status_text: str):
        """Restores UI buttons and updates final status."""
        self.is_processing = False
        self.btn_start.configure(state="normal")
        self.btn_cancel.configure(state="disabled")
        self.lbl_status.configure(text=f"Status: {status_text}")
        self.log_message(f"\nTask Finished: {status_text}")
