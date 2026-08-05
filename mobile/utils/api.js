/**
 * api.js - Mobile REST API Client.
 * Handles server health checks and multipart image upload to Python FastAPI backend.
 */

// Default Server URL (Can be changed dynamically by user in app settings)
let SERVER_URL = "http://192.168.1.100:8000";

export const setServerUrl = (url) => {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = `http://${url}`;
  }
  // Trim trailing slashes
  SERVER_URL = url.replace(/\/+$/, "");
};

export const getServerUrl = () => SERVER_URL;

/**
 * Checks server connectivity and hardware status.
 */
export const checkServerHealth = async (customUrl = null) => {
  const targetUrl = customUrl || SERVER_URL;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`${targetUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    }
    return { success: false, error: "Server returned error" };
  } catch (err) {
    return { success: false, error: err.message };
  }
};

/**
 * Uploads an image to FastAPI server and returns processed transparent PNG as base64 URI.
 */
export const processImageOnServer = async (imageUri, options = {}) => {
  const { removeBg = true, upscale = true, scaleFactor = 4 } = options;

  try {
    const formData = new FormData();

    // Append image file object for React Native FormData
    const filename = imageUri.split("/").pop() || "photo.jpg";
    const match = /\.(\w+)$/.exec(filename);
    const type = match ? `image/${match[1]}` : `image/jpeg`;

    formData.append("file", {
      uri: imageUri,
      name: filename,
      type: type,
    });

    formData.append("remove_bg", removeBg ? "true" : "false");
    formData.append("upscale", upscale ? "true" : "false");
    formData.append("scale_factor", scaleFactor.toString());

    const response = await fetch(`${SERVER_URL}/api/process`, {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server error (${response.status}): ${errText}`);
    }

    // Convert response binary blob to base64 data URI for React Native Image rendering
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result); // Base64 Data URI string
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.error("API processImage error:", err);
    throw err;
  }
};
