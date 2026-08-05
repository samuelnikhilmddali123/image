# 🖼️ AI Image Studio - Desktop & Mobile (Expo SDK 54) Application

A complete, production-ready AI Image Background Remover and Real-ESRGAN Upscaler solution. Includes a **CustomTkinter Desktop App**, a **FastAPI REST Server**, and an **Expo SDK 54 Mobile App**.

Automatically removes backgrounds (preserving fine details like hair, glass, and transparent plastic) and upscales images up to **4x resolution** preserving colors and textures.

---

## 📂 Project Architecture

```
imaGE/
├── app.py                   # CustomTkinter Desktop Application
├── server.py                # FastAPI Backend REST Server for Mobile App
├── background_remover.py    # RMBG-2.0 & U2Net Background Remover Engine
├── upscaler.py              # Real-ESRGAN x4 / x2 Upscaling Engine (tiled)
├── utils.py                 # File scanner, device detector, & image loaders
├── requirements.txt         # Pinned python packages
├── README.md                # This manual
├── venv/                    # Local Python virtual environment
└── mobile/                  # Expo SDK 54 Mobile Application
    ├── App.js               # Main React Native interface & state
    ├── app.json             # Expo project configuration
    ├── package.json         # Mobile dependencies
    ├── utils/
    │   └── api.js           # REST API client
    └── assets/              # App launcher icons & splash screen placeholders
```

---

## ⚡ Setup & Desktop App Guide

### 1. Install & Activate Environment
```powershell
# Create & activate venv
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependency packages
pip install -r requirements.txt
```
*(For NVIDIA GPU acceleration)*:
```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

### 2. Launch Desktop GUI
```powershell
python app.py
```

---

## 📱 FastAPI Server & Mobile App Guide (Expo SDK 54)

To run the AI Image Studio on your iOS or Android phone:

### 1. Launch FastAPI Backend
Start the server on your PC. It will automatically detect and print your local network IP:
```powershell
python server.py
```
*Console output example:*
```text
=======================================================
🚀 AI Image Studio FastAPI Server Starting!
📡 Connect your Expo Mobile App to: http://192.168.1.15:8000
=======================================================
```
Keep this terminal window running.

### 2. Setup Expo Mobile Client
In a new terminal window, navigate to the `mobile/` directory, install Node modules, and launch the Expo development server:

```bash
# Navigate to mobile project folder
cd mobile

# Install dependencies
npm install

# Start Expo dev server
npx expo start
```

### 3. Connect & Run on Phone
1. Download **Expo Go** from the iOS App Store or Android Google Play Store.
2. Scan the QR code displayed in your terminal using:
   - Android: **Expo Go** built-in QR scanner.
   - iOS: System **Camera App**.
3. Tap the **Settings gear icon (⚙️)** in the top right of the mobile screen.
4. Enter your PC's IP address (e.g. `http://192.168.1.15:8000`) and tap **Connect**.
5. Select an image from your gallery, choose options, and tap **🚀 Start Processing**!

---

## 📦 Packaging Standalone Executables

### Desktop App Windows Executable:
```powershell
pyinstaller --noconfirm --onedir --windowed `
  --name "AI_Image_Studio" `
  --add-data "models;models" `
  --collect-all customtkinter `
  --collect-all rembg `
  app.py
```

### Mobile App (Build IPA / APK via EAS):
```bash
cd mobile
npm install -g eas-cli
eas build --platform all
```
