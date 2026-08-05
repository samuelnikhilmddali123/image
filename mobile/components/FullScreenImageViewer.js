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
 * designed for before/after comparison with pinch-to-zoom and hold-to-compare functionality.
 *
 * Props:
 * - visible (boolean): Controls visibility of the viewer modal.
 * - originalImage (string): URI of the original image.
 * - resultImage (string): URI of the processed (upscaled/bg-removed) image.
 * - initialImage (string): Either 'original' or 'result' (specifies which to show first).
 * - onClose (function): Callback when the viewer is closed.
 */
export default function FullScreenImageViewer({
  visible,
  originalImage,
  resultImage,
  initialImage = 'result',
  onClose,
}) {
  // Toggle state between Original and Result images
  const [showOriginal, setShowOriginal] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);

  // Animation values for scale, position, and hint opacity
  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const hintOpacity = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current; // Modal entry animation

  // Touch gesture helper states
  const lastScale = useRef(1);
  const startDistance = useRef(null);
  const lastTap = useRef(null);

  // Reset states when the viewer becomes visible
  useEffect(() => {
    if (visible) {
      setShowOriginal(initialImage === 'original');
      setHintVisible(true);
      scale.setValue(1);
      pan.setValue({ x: 0, y: 0 });
      lastScale.current = 1;
      fadeAnim.setValue(0);
      hintOpacity.setValue(1);

      // Smooth entry animation
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();

      // Fade out the helper hint text after 3 seconds
      const timer = setTimeout(() => {
        Animated.timing(hintOpacity, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }).start(() => setHintVisible(false));
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Helper function to calculate distance between two touch coordinates (for pinch zoom)
  const getDistance = (touches) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Helper function to calculate mid-point of two touches (to anchor zoom origin)
  const getTouchCenter = (touches) => {
    return {
      x: (touches[0].pageX + touches[1].pageX) / 2,
      y: (touches[0].pageY + touches[1].pageY) / 2,
    };
  };

  // Create a custom PanResponder to handle multi-touch gestures and taps
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        
        // 1. Detect Double Tap to Zoom
        const now = Date.now();
        if (lastTap.current && now - lastTap.current < 300) {
          // Double tapped: toggle zoom between 1x and 2.5x
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

        // 3. Before/After Comparison - Switch to original when touch starts (if not zooming)
        // Only trigger comparison if it is a single-touch press
        if (touches.length === 1 && lastScale.current === 1) {
          setShowOriginal(true);
        }
      },

      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

        // Handle Pinch-to-Zoom (Two fingers)
        if (touches.length === 2) {
          // If we had single finger holding original, release it since user is zooming now
          setShowOriginal(false);

          if (startDistance.current) {
            const currentDistance = getDistance(touches);
            const rawScale = (currentDistance / startDistance.current) * lastScale.current;
            // Limit zoom scale between 1x and 4x
            const boundedScale = Math.max(1, Math.min(rawScale, 4));
            scale.setValue(boundedScale);
          }
        } 
        // Handle Panning / Dragging (One finger, only when zoomed in)
        else if (touches.length === 1 && lastScale.current > 1) {
          // Track movement of single finger
          pan.setValue({
            x: gestureState.dx + (pan.x._value - gestureState.dx), // smooth drag offset
            y: gestureState.dy + (pan.y._value - gestureState.dy),
          });
        }
      },

      onPanResponderRelease: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;

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

        // Reset pinch distance reference
        startDistance.current = null;

        // When finger is lifted, return preview back to Result image instantly
        setShowOriginal(initialImage === 'original');
      },
      
      onPanResponderTerminate: () => {
        // Reset state on gesture cancellation
        setShowOriginal(initialImage === 'original');
      }
    })
  ).current;

  // Handle closing with animations
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
        
        {/* Absolute Header - Close Button */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Gestures Area (Active for both Pan / Pinch / Hold) */}
        <View style={styles.gestureContainer} {...panResponder.panHandlers}>
          
          {/* Animated wrapper supporting pan offsets and scale factors */}
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
            {/* Preload and visibility control for maximum performance without reloads */}
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

        {/* Helper Hint popup */}
        {hintVisible && (
          <Animated.View style={[styles.hintContainer, { opacity: hintOpacity }]}>
            <Text style={styles.hintText}>👆 Hold screen to compare with Original</Text>
          </Animated.View>
        )}
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
    height: SCREEN_HEIGHT * 0.8,
  },
  hintContainer: {
    position: 'absolute',
    bottom: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  hintText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
