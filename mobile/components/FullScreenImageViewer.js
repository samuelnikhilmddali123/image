import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { Image } from 'expo-image';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * FullScreenImageViewer - A professional full-screen image viewer component
 * featuring a floating bottom navigation bar for before/after comparison,
 * alongside pinch-to-zoom and pan interactions.
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

  // Animation values for scale, position, and modal fade transition
  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Touch gesture helper states
  const lastScale = useRef(1);
  const startDistance = useRef(null);
  const lastTap = useRef(null);

  // Synchronize state when the viewer becomes visible
  useEffect(() => {
    if (visible) {
      setShowOriginal(initialImage === 'before');
      scale.setValue(1);
      pan.setValue({ x: 0, y: 0 });
      lastScale.current = 1;
      fadeAnim.setValue(0);

      // Smooth entry transition
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, initialImage]);

  // Helper function to calculate distance between two touch coordinates (for pinch zoom)
  const getDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Create a custom PanResponder to handle zoom gestures and panning
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        
        // 1. Double Tap to Zoom
        const now = Date.now();
        if (lastTap.current && now - lastTap.current < 300) {
          const targetScale = lastScale.current > 1 ? 1 : 2.5;
          lastScale.current = targetScale;
          
          Animated.parallel([
            Animated.spring(scale, {
              toValue: targetScale,
              useNativeDriver: true,
            }),
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: true,
            }),
          ]).start();
          return;
        }
        lastTap.current = now;

        // 2. Setup initial pinch-to-zoom values if two fingers are active
        if (touches.length === 2) {
          startDistance.current = getDistance(touches);
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        // Handle Pinch-to-Zoom (Two fingers)
        if (touches.length === 2) {
          if (startDistance.current) {
            const currentDistance = getDistance(touches);
            const rawScale = (currentDistance / startDistance.current) * lastScale.current;
            const boundedScale = Math.max(1, Math.min(rawScale, 4));
            scale.setValue(boundedScale);
          }
        } 
        // Handle Panning / Dragging (One finger, only when zoomed in)
        else if (touches.length === 1 && lastScale.current > 1) {
          pan.setValue({
            x: gestureState.dx + (pan.x._value - gestureState.dx),
            y: gestureState.dy + (pan.y._value - gestureState.dy),
          });
        }
      },

      onPanResponderRelease: (evt, gestureState) => {
        // Update the scale baseline reference
        lastScale.current = scale._value;

        // If zoomed out, reset position back to center smoothly
        if (lastScale.current <= 1.05) {
          lastScale.current = 1;
          Animated.parallel([
            Animated.spring(scale, {
              toValue: 1,
              friction: 7,
              useNativeDriver: true,
            }),
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              friction: 7,
              useNativeDriver: true,
            }),
          ]).start();
        }

        startDistance.current = null;
      },
    })
  ).current;

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

        {/* Gestures Area */}
        <View style={styles.gestureContainer} {...panResponder.panHandlers}>
          <Animated.View
            style={[
              styles.imageWrapper,
              {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                  { scale: scale },
                ],
              },
            ]}
          >
            {/* Preloaded Images - swapped visibility to keep state & zoom consistent */}
            <Image
              source={{ uri: originalImage }}
              style={[
                styles.image,
                { opacity: showOriginal ? 1 : 0, position: 'absolute' }
              ]}
              contentFit="contain"
            />
            <Image
              source={{ uri: resultImage || originalImage }}
              style={[
                styles.image,
                { opacity: !showOriginal ? 1 : 0 }
              ]}
              contentFit="contain"
            />
          </Animated.View>
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
  imageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.75,
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
