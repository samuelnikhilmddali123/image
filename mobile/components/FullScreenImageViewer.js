import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';
import ZoomableImage from './ZoomableImage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * FullScreenImageViewer - A professional full-screen image viewer component
 * featuring a floating bottom navigation bar for before/after comparison,
 * powered by a high-performance ZoomableImage gesture component.
 *
 * Props:
 * - visible (boolean): Controls visibility of the viewer modal.
 * - originalImage (string): URI of the original image.
 * - resultImage (string): URI of the processed (upscaled/bg-removed) image.
 * - initialImage (string): Either 'before' or 'after' (specifies which to show first).
 * - onClose (function): Callback when the viewer is closed.
 */
export default function FullScreenImageViewer({
  visible,
  originalImage,
  resultImage,
  initialImage = 'after',
  onClose,
}) {
  // Toggle state between Original and Result images
  const [showOriginal, setShowOriginal] = useState(false);

  // Modal fade transition animation value
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Synchronize state when the viewer becomes visible
  useEffect(() => {
    if (visible) {
      setShowOriginal(initialImage === 'before');
      fadeAnim.setValue(0);

      // Smooth entry transition
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, initialImage]);

  // Close animation handler
  const handleClose = () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(onClose);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
    >
      <Animated.View style={[styles.modalContainer, { opacity: fadeAnim }]}>
        
        {/* Close (X) button at the top */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* High-Performance Zoomable Image Area */}
        <View style={styles.gestureContainer}>
          <ZoomableImage
            key={visible ? 'active' : 'inactive'}
            source={{ uri: showOriginal ? originalImage : (resultImage || originalImage) }}
            resetOnSourceChange={false}
            contentFit="contain"
            isActive={visible}
          />
        </View>

        {/* Floating Bottom Navigation Toggle Bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={[styles.navButton, showOriginal && styles.navButtonActive]}
            activeOpacity={0.8}
            onPress={() => setShowOriginal(true)}
          >
            <Text style={[styles.navButtonText, showOriginal && styles.navButtonTextActive]}>
              Before
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, !showOriginal && styles.navButtonActive]}
            activeOpacity={0.8}
            onPress={() => setShowOriginal(false)}
          >
            <Text style={[styles.navButtonText, !showOriginal && styles.navButtonTextActive]}>
              After
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 100,
  },
  closeButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  gestureContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBar: {
    position: 'absolute',
    bottom: 50,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    padding: 6,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
    zIndex: 100,
  },
  navButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 100,
  },
  navButtonActive: {
    backgroundColor: '#3b82f6',
  },
  navButtonText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  navButtonTextActive: {
    color: '#ffffff',
  },
});
