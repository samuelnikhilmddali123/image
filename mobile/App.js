import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  ScrollView,
  SafeAreaView,
  StatusBar,
  TextInput,
  Modal,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { Image } from 'expo-image';
import { checkServerHealth, processImageOnServer, getServerUrl, setServerUrl } from './utils/api';

const { width } = Dimensions.get('window');

export default function App() {
  // Batch states
  const [selectedImages, setSelectedImages] = useState([]); // Array of URIs
  const [currentOriginal, setCurrentOriginal] = useState(null);
  const [currentProcessed, setCurrentProcessed] = useState(null);
  const [processedImages, setProcessedImages] = useState([]); // Array of base64 URIs

  // UI state
  const [loading, setLoading] = useState(false);
  const [progressVal, setProgressVal] = useState(0); // 0.0 to 1.0
  const [statusText, setStatusText] = useState('Ready');
  const [logs, setLogs] = useState([]);

  // Option toggles
  const [removeBg, setRemoveBg] = useState(true);
  const [upscale, setUpscale] = useState(true);
  const [scaleFactor, setScaleFactor] = useState(4); // 2 or 4

  // Connection settings
  const [modalVisible, setModalVisible] = useState(false);
  const [tempUrl, setTempUrl] = useState(getServerUrl());
  const [serverOnline, setServerOnline] = useState(false);
  const [serverStatus, setServerStatus] = useState('Checking...');

  const logScrollRef = useRef();

  useEffect(() => {
    testConnection(getServerUrl());
  }, []);

  const addLog = (message) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs((prevLogs) => [...prevLogs, `[${time}] ${message}`]);
  };

  const testConnection = async (url) => {
    setServerStatus('Connecting...');
    const result = await checkServerHealth(url);
    if (result.success) {
      setServerStatus(`Online (${result.data.device})`);
      setServerOnline(true);
      addLog(`Connected to server: ${url} (${result.data.device})`);
      return true;
    } else {
      setServerStatus('Offline');
      setServerOnline(false);
      addLog(`Connection failed to server: ${url}`);
      return false;
    }
  };

  const saveServerConfig = async () => {
    const works = await testConnection(tempUrl);
    if (works) {
      setServerUrl(tempUrl);
      setModalVisible(false);
    } else {
      Alert.alert('Connection Failed', 'Please verify your server IP/Port.');
    }
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please grant photo library access.');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true, // Batch selection enabled!
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uris = result.assets.map(asset => asset.uri);
      setSelectedImages(uris);
      setCurrentOriginal(uris[0]);
      setCurrentProcessed(null);
      setProcessedImages([]);
      setLogs([]);
      setProgressVal(0);
      setStatusText(`${uris.length} image(s) loaded.`);
      addLog(`Loaded ${uris.length} image(s) from gallery.`);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Please grant camera access.');
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      quality: 1,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      setSelectedImages([uri]);
      setCurrentOriginal(uri);
      setCurrentProcessed(null);
      setProcessedImages([]);
      setLogs([]);
      setProgressVal(0);
      setStatusText('1 image captured.');
      addLog('Captured image from camera.');
    }
  };

  const processBatch = async () => {
    if (selectedImages.length === 0) {
      Alert.alert('No Images', 'Please select or capture images first.');
      return;
    }
    if (!serverOnline) {
      Alert.alert('Server Offline', 'Please connect to your backend PC server.');
      return;
    }

    setLoading(true);
    const total = selectedImages.length;
    addLog(`Starting batch processing of ${total} images...`);

    const outputs = [];

    for (let i = 0; i < total; i++) {
      const currentUri = selectedImages[i];
      const filename = currentUri.split('/').pop() || `image_${i}.jpg`;
      
      setCurrentOriginal(currentUri);
      setCurrentProcessed(null);
      setStatusText(`Processing [${i + 1}/${total}]: ${filename}`);
      addLog(`[${i + 1}/${total}] Processing ${filename}`);
      setProgressVal(i / total);

      try {
        if (removeBg) addLog(' -> Removing background...');
        if (upscale) addLog(` -> Upscaling (${scaleFactor}x)...`);

        const resultBase64 = await processImageOnServer(currentUri, {
          removeBg,
          upscale,
          scaleFactor,
        });

        outputs.push(resultBase64);
        setCurrentProcessed(resultBase64);
        addLog(` -> Success!`);
      } catch (err) {
        addLog(` ❌ Failed: ${err.message}`);
        // Continue loop even if one image fails, matching desktop fallback!
      }
      
      setProgressVal((i + 1) / total);
    }

    setProcessedImages(outputs);
    setStatusText('Processing complete!');
    addLog(`Batch completed. ${outputs.length} image(s) processed successfully.`);
    setLoading(false);
  };

  const shareBatchResults = async () => {
    if (processedImages.length === 0) return;

    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing Unavailable', 'Native sharing is not supported.');
      return;
    }

    try {
      const FileSystem = require('expo-file-system');
      
      // If single image, share it directly
      if (processedImages.length === 1) {
        const filename = `AI_Processed_${Date.now()}.png`;
        const localUri = `${FileSystem.documentDirectory}${filename}`;
        const base64Data = processedImages[0].split(',')[1];
        
        await FileSystem.writeAsStringAsync(localUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await Sharing.shareAsync(localUri);
      } else {
        // If multiple images, share them one by one or notify user
        addLog('Sharing batch outputs...');
        for (let i = 0; i < processedImages.length; i++) {
          const filename = `AI_Processed_Batch_${i + 1}.png`;
          const localUri = `${FileSystem.documentDirectory}${filename}`;
          const base64Data = processedImages[i].split(',')[1];
          
          await FileSystem.writeAsStringAsync(localUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await Sharing.shareAsync(localUri);
        }
      }
    } catch (err) {
      Alert.alert('Share Error', err.message);
    }
  };

  const clearWorkspace = () => {
    setSelectedImages([]);
    setCurrentOriginal(null);
    setCurrentProcessed(null);
    setProcessedImages([]);
    setLogs([]);
    setProgressVal(0);
    setStatusText('Ready');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Header Area */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>✨ AI Studio</Text>
          <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: serverOnline ? '#10b981' : '#ef4444' }]} />
            <Text style={styles.statusText}>{serverOnline ? 'Connected to PC' : 'Offline - Tap to connect'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => setModalVisible(true)}>
          <Text style={styles.settingsIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Previews Area (Original and Processed side-by-side or stacked) */}
        <View style={styles.previewSection}>
          {currentOriginal ? (
            <View style={styles.previewsWrapper}>
              {/* Original preview */}
              <View style={styles.previewBox}>
                <Image source={{ uri: currentOriginal }} style={styles.previewImage} contentFit="contain" />
                <Text style={styles.previewLabel}>Original</Text>
              </View>

              {/* Processed preview */}
              <View style={styles.previewBox}>
                {currentProcessed ? (
                  <Image source={{ uri: currentProcessed }} style={styles.previewImage} contentFit="contain" />
                ) : (
                  <View style={styles.previewPlaceholder}>
                    <Text style={styles.previewPlaceholderText}>
                      {loading ? 'Processing...' : 'Result Preview'}
                    </Text>
                  </View>
                )}
                <Text style={styles.previewLabel}>Result</Text>
              </View>
            </View>
          ) : (
            <View style={styles.placeholderCard}>
              <Text style={styles.placeholderEmoji}>🖼️</Text>
              <Text style={styles.placeholderText}>Select image(s) to start processing</Text>
              <View style={styles.placeholderButtons}>
                <TouchableOpacity style={styles.pickBtn} onPress={pickImages}>
                  <Text style={styles.btnText}>📁 Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickBtn, styles.secondaryPickBtn]} onPress={takePhoto}>
                  <Text style={styles.btnText}>📷 Camera</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {selectedImages.length > 0 && (
          <View style={styles.repickRow}>
            <TouchableOpacity style={styles.repickBtn} onPress={pickImages}>
              <Text style={styles.repickText}>📁 Change Images</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.repickBtn} onPress={takePhoto}>
              <Text style={styles.repickText}>📷 Take Photo</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Feature Switches Area */}
        <View style={styles.controlCard}>
          <Text style={styles.sectionTitle}>AI Features</Text>

          <View style={styles.switchRow}>
            <View>
              <Text style={styles.optionLabel}>Remove Background</Text>
              <Text style={styles.optionSub}>Uses RMBG-2.0 / rembg engine</Text>
            </View>
            <Switch
              value={removeBg}
              onValueChange={setRemoveBg}
              trackColor={{ false: '#334155', true: '#2563eb' }}
              thumbColor={removeBg ? '#ffffff' : '#94a3b8'}
            />
          </View>

          <View style={styles.switchRow}>
            <View>
              <Text style={styles.optionLabel}>Super Resolution Upscale</Text>
              <Text style={styles.optionSub}>Uses Real-ESRGAN x4</Text>
            </View>
            <Switch
              value={upscale}
              onValueChange={setUpscale}
              trackColor={{ false: '#334155', true: '#2563eb' }}
              thumbColor={upscale ? '#ffffff' : '#94a3b8'}
            />
          </View>

          {upscale && (
            <View style={styles.scaleRow}>
              <Text style={styles.optionLabel}>Upscale Factor:</Text>
              <View style={styles.scaleButtons}>
                <TouchableOpacity
                  style={[styles.scaleBtn, scaleFactor === 2 && styles.scaleBtnActive]}
                  onPress={() => setScaleFactor(2)}
                >
                  <Text style={[styles.scaleText, scaleFactor === 2 && styles.scaleTextActive]}>2x</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.scaleBtn, scaleFactor === 4 && styles.scaleBtnActive]}
                  onPress={() => setScaleFactor(4)}
                >
                  <Text style={[styles.scaleText, scaleFactor === 4 && styles.scaleTextActive]}>4x</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Progress & Log Area */}
        {selectedImages.length > 0 && (
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressStatus}>{statusText}</Text>
              <Text style={styles.progressPercent}>{Math.round(progressVal * 100)}%</Text>
            </View>
            
            {/* Progress Bar Widget */}
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressVal * 100}%` }]} />
            </View>

            {/* Log Terminal Screen */}
            <Text style={styles.logTitle}>Processing Logs:</Text>
            <View style={styles.logTerminal}>
              <ScrollView
                ref={logScrollRef}
                onContentSizeChange={() => logScrollRef.current?.scrollToEnd({ animated: true })}
                style={styles.logScrollView}
              >
                {logs.length === 0 ? (
                  <Text style={styles.emptyLogText}>Logs will appear here...</Text>
                ) : (
                  logs.map((log, index) => (
                    <Text key={index} style={styles.logLine}>{log}</Text>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        )}

        {/* Start / Action Buttons */}
        {selectedImages.length > 0 && (
          <View style={styles.actionRow}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#2563eb" />
                <Text style={styles.loadingText}>Running AI processes on PC...</Text>
              </View>
            ) : processedImages.length > 0 ? (
              <View style={styles.resultActions}>
                <TouchableOpacity style={styles.actionBtnShare} onPress={shareBatchResults}>
                  <Text style={styles.actionBtnText}>📤 Save / Share Processed PNG</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtnReset} onPress={clearWorkspace}>
                  <Text style={styles.actionBtnResetText}>Clear</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.actionBtnProcess} onPress={processBatch}>
                <Text style={styles.actionBtnText}>🚀 Start Processing</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Settings Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📡 Connect to PC Server</Text>
            <Text style={styles.modalDesc}>
              Enter the local IP address or Cloudflare Tunnel link of your running Python backend.
            </Text>

            <TextInput
              style={styles.modalInput}
              value={tempUrl}
              onChangeText={setTempUrl}
              placeholder="https://xxx.trycloudflare.com"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalStatusRow}>
              <Text style={styles.modalStatusLabel}>Status:</Text>
              <Text style={[styles.modalStatusValue, { color: serverOnline ? '#10b981' : '#ef4444' }]}>
                {serverStatus}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setModalVisible(false)}>
                <Text style={styles.modalBtnTextCancel}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnSave]} onPress={saveServerConfig}>
                <Text style={styles.modalBtnTextSave}>Connect</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  settingsBtn: {
    padding: 8,
    backgroundColor: '#1e293b',
    borderRadius: 8,
  },
  settingsIcon: {
    fontSize: 18,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  previewSection: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  previewsWrapper: {
    flexDirection: 'row',
    padding: 10,
  },
  previewBox: {
    flex: 1,
    aspectRatio: 1,
    margin: 5,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewLabel: {
    position: 'absolute',
    bottom: 5,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: 'bold',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  previewPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewPlaceholderText: {
    color: '#475569',
    fontSize: 12,
  },
  placeholderCard: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  placeholderEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  placeholderText: {
    color: '#94a3b8',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  placeholderButtons: {
    flexDirection: 'row',
  },
  pickBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginHorizontal: 8,
  },
  secondaryPickBtn: {
    backgroundColor: '#334155',
  },
  btnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  repickRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 15,
  },
  repickBtn: {
    backgroundColor: '#1e293b',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  repickText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  controlCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  optionLabel: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
  optionSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  scaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 15,
  },
  scaleButtons: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 4,
  },
  scaleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  scaleBtnActive: {
    backgroundColor: '#2563eb',
  },
  scaleText: {
    color: '#94a3b8',
    fontWeight: '600',
  },
  scaleTextActive: {
    color: '#ffffff',
  },
  progressCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressStatus: {
    color: '#f8fafc',
    fontWeight: 'bold',
    fontSize: 14,
  },
  progressPercent: {
    color: '#2563eb',
    fontWeight: 'bold',
    fontSize: 14,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#0f172a',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563eb',
  },
  logTitle: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 15,
    marginBottom: 8,
  },
  logTerminal: {
    height: 120,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  logScrollView: {
    flex: 1,
  },
  emptyLogText: {
    color: '#475569',
    fontSize: 12,
    fontStyle: 'italic',
  },
  logLine: {
    color: '#10b981',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  actionRow: {
    marginTop: 25,
  },
  actionBtnProcess: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 10,
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 10,
    fontSize: 14,
  },
  resultActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtnShare: {
    flex: 1,
    backgroundColor: '#10b981',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginRight: 10,
  },
  actionBtnReset: {
    backgroundColor: '#ef4444',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionBtnResetText: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  modalDesc: {
    color: '#94a3b8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  modalInput: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    color: '#f8fafc',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 15,
  },
  modalStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  modalStatusLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  modalStatusValue: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginLeft: 10,
  },
  modalBtnCancel: {
    backgroundColor: 'transparent',
  },
  modalBtnSave: {
    backgroundColor: '#2563eb',
  },
  modalBtnTextCancel: {
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  modalBtnTextSave: {
    color: '#ffffff',
    fontWeight: 'bold',
  },
});
