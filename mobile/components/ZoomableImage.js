import React, { useState, useCallback, useEffect } from 'react';
import { StyleSheet, Dimensions, View, Text } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDecay,
  runOnJS,
  cancelAnimation,
} from 'react-native-reanimated';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 3;

function ZoomableImage({ 
  source, 
  style, 
  contentFit = 'contain', 
  onZoomChange, 
  intrinsicWidth, 
  intrinsicHeight, 
  recyclingKey, 
  isActive = true, 
  onPress, 
  containerWidth: propContainerWidth, 
  containerHeight: propContainerHeight,
  resetOnSourceChange = true,
}) {
  // Shared values
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const isDoubleTapping = useSharedValue(0);

  // Layout shared values - use props if provided, otherwise fallback to static dimensions
  const containerWidth = useSharedValue(propContainerWidth || SCREEN_WIDTH);
  const containerHeight = useSharedValue(propContainerHeight || SCREEN_HEIGHT);

  const initialW = intrinsicWidth || 0;
  const initialH = intrinsicHeight || 0;

  const imageWidth = useSharedValue(initialW);
  const imageHeight = useSharedValue(initialH);

  const [intrinsicDims, setIntrinsicDims] = useState(
    (intrinsicWidth && intrinsicHeight) ? { width: intrinsicWidth, height: intrinsicHeight } : null
  );

  const [hasError, setHasError] = useState(false);

  // Notify parent
  const setIsZoomed = useCallback((zoomed) => {
    if (onZoomChange) {
      onZoomChange(zoomed);
    }
  }, [onZoomChange]);

  const resetZoom = useCallback(() => {
    scale.value = withSpring(1);
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    isDoubleTapping.value = 0;
    setIsZoomed(false);
  }, [scale, translateX, translateY, savedScale, savedTranslateX, savedTranslateY, isDoubleTapping, setIsZoomed]);

  const resetZoomUI = () => {
    'worklet';
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    scale.value = withTiming(1, { duration: 200 });
    translateX.value = withTiming(0, { duration: 200 });
    translateY.value = withTiming(0, { duration: 200 });
    savedScale.value = 1;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    isDoubleTapping.value = 0;
    runOnJS(setIsZoomed)(false);
  };

  useEffect(() => {
    if (resetOnSourceChange) {
      resetZoom();
    }

    if (intrinsicWidth && intrinsicHeight) {
      imageWidth.value = intrinsicWidth;
      imageHeight.value = intrinsicHeight;
      setIntrinsicDims(prev => {
        if (prev && prev.width === intrinsicWidth && prev.height === intrinsicHeight) return prev;
        return { width: intrinsicWidth, height: intrinsicHeight };
      });
    } else {
      imageWidth.value = 0;
      imageHeight.value = 0;
      setIntrinsicDims(null);
    }
    setHasError(false);
  }, [recyclingKey, intrinsicWidth, intrinsicHeight, imageWidth, imageHeight, resetZoom, resetOnSourceChange]);

  // Update container dimensions when props change (for orientation changes)
  useEffect(() => {
    if (propContainerWidth) {
      containerWidth.value = propContainerWidth;
    }
    if (propContainerHeight) {
      containerHeight.value = propContainerHeight;
    }
  }, [propContainerWidth, propContainerHeight, containerWidth, containerHeight]);

  const clamp = (value, lower, upper) => {
    'worklet';
    return Math.min(Math.max(value, lower), upper);
  };

  const getDisplayedDimensions = () => {
    'worklet';
    const containerW = containerWidth.value;
    const containerH = containerHeight.value;
    const imgW = imageWidth.value;
    const imgH = imageHeight.value;

    if (imgW === 0 || imgH === 0) {
      return { displayedWidth: containerW, displayedHeight: containerH };
    }

    const wRatio = containerW / imgW;
    const hRatio = containerH / imgH;
    // Scale factor to FIT the image, but cap at 1.0 to avoid stretching small images
    const scaleFactor = Math.min(1, Math.min(wRatio, hRatio));

    return {
      displayedWidth: imgW * scaleFactor,
      displayedHeight: imgH * scaleFactor
    };
  };

  const getBounds = (currentScale) => {
    'worklet';
    const { displayedWidth, displayedHeight } = getDisplayedDimensions();

    const zoomedWidth = displayedWidth * currentScale;
    const zoomedHeight = displayedHeight * currentScale;

    const maxTranslateX = Math.max(0, (zoomedWidth - containerWidth.value) / 2);
    const maxTranslateY = Math.max(0, (zoomedHeight - containerHeight.value) / 2);

    return { maxTranslateX, maxTranslateY };
  };

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((e) => {
      'worklet';
      isDoubleTapping.value = 1;
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(scale);

      if (scale.value > 1.05) {
        scale.value = withTiming(1, { duration: 300 }, () => {
          isDoubleTapping.value = 0;
        });
        translateX.value = withTiming(0, { duration: 300 });
        translateY.value = withTiming(0, { duration: 300 });
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        runOnJS(setIsZoomed)(false);
      } else {
        const targetScale = DOUBLE_TAP_SCALE;
        const cx = containerWidth.value / 2;
        const cy = containerHeight.value / 2;

        let targetX = (cx - e.x) * (targetScale - 1);
        let targetY = (cy - e.y) * (targetScale - 1);

        const { maxTranslateX, maxTranslateY } = getBounds(targetScale);
        targetX = clamp(targetX, -maxTranslateX, maxTranslateX);
        targetY = clamp(targetY, -maxTranslateY, maxTranslateY);

        scale.value = withTiming(targetScale, { duration: 300 }, () => {
          isDoubleTapping.value = 0;
        });
        translateX.value = withTiming(targetX, { duration: 300 });
        translateY.value = withTiming(targetY, { duration: 300 });

        savedScale.value = targetScale;
        savedTranslateX.value = targetX;
        savedTranslateY.value = targetY;
        runOnJS(setIsZoomed)(true);
      }
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(setIsZoomed)(true);
    })
    .onUpdate((e) => {
      'worklet';
      const newScale = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
      scale.value = newScale;
    })
    .onEnd(() => {
      'worklet';
      if (scale.value <= 1.01) {
        resetZoomUI();
      } else {
        const finalScale = Math.min(scale.value, MAX_SCALE);
        const { maxTranslateX, maxTranslateY } = getBounds(finalScale);
        const finalTranslateX = clamp(translateX.value, -maxTranslateX, maxTranslateX);
        const finalTranslateY = clamp(translateY.value, -maxTranslateY, maxTranslateY);

        scale.value = withTiming(finalScale);
        translateX.value = withTiming(finalTranslateX);
        translateY.value = withTiming(finalTranslateY);

        savedScale.value = finalScale;
        savedTranslateX.value = finalTranslateX;
        savedTranslateY.value = finalTranslateY;
        runOnJS(setIsZoomed)(true);
      }
    });

  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .averageTouches(true)
    .onTouchesMove((e, state) => {
      'worklet';
      if (isDoubleTapping.value === 1) {
        state.fail();
        return;
      }
      if (scale.value > 1.01) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onStart(() => {
      'worklet';
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (isDoubleTapping.value === 1) return;

      let nextX = savedTranslateX.value + e.translationX;
      let nextY = savedTranslateY.value + e.translationY;

      const { maxTranslateX, maxTranslateY } = getBounds(scale.value);
      nextX = clamp(nextX, -maxTranslateX, maxTranslateX);
      nextY = clamp(nextY, -maxTranslateY, maxTranslateY);

      translateX.value = nextX;
      translateY.value = nextY;
    })
    .onEnd((e) => {
      'worklet';
      if (isDoubleTapping.value === 1 || scale.value <= 1.01) {
        if (scale.value <= 1.01) resetZoomUI();
        return;
      }

      const { maxTranslateX, maxTranslateY } = getBounds(scale.value);
      translateX.value = withDecay({
        velocity: e.velocityX,
        clamp: [-maxTranslateX, maxTranslateX],
      });
      translateY.value = withDecay({
        velocity: e.velocityY,
        clamp: [-maxTranslateY, maxTranslateY],
      });
    });

  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onStart(() => {
      'worklet';
      if (onPress) {
        runOnJS(onPress)();
      }
    });

  // Make single tap wait for double tap failure to differentiate
  const exclusiveSingleTap = Gesture.Exclusive(doubleTapGesture, singleTapGesture);

  const finalGesture = Gesture.Simultaneous(exclusiveSingleTap, pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => {
    // Calculate actual displayed image dimensions (aspect ratio fit)
    const { displayedWidth, displayedHeight } = getDisplayedDimensions();

    return {
      width: displayedWidth,
      height: displayedHeight,
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: scale.value },
      ],
    };
  });

  if (hasError) {
    return (
      <View style={[styles.container, style, styles.errorContainer]}>
        <Text style={styles.text}>Failed to load image</Text>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        containerWidth.value = width;
        containerHeight.value = height;
      }}
    >
      <GestureDetector gesture={finalGesture}>
        <View style={styles.gestureContainer}>
          <Animated.View style={[styles.imageWrapper, animatedStyle]}>
            <Image
              source={source}
              style={{ width: '100%', height: '100%' }}
              contentFit={contentFit}
              transition={0}
              cachePolicy="memory-disk"
              priority="high"
              recyclingKey={recyclingKey}
              onLoad={(e) => {
                const { width, height } = e.source;
                if (!intrinsicWidth) {
                  imageWidth.value = width;
                  imageHeight.value = height;
                  setIntrinsicDims({ width, height });
                }
              }}
              onError={() => setHasError(true)}
              enableLiveTextInteraction={false}
              allowDownscaling={false}
              preferHighDynamicRange
            />
          </Animated.View>
        </View>
      </GestureDetector>
      {!intrinsicDims && !hasError && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black'
  },
  imageWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  gestureContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: 'white'
  }
});

export default ZoomableImage;
