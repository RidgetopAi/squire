import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// CAMERA MODE STORE
// ============================================
// Manages village camera mode (walk/fly) with localStorage persistence

export type CameraMode = 'walk' | 'fly';

interface CameraState {
  // State
  mode: CameraMode;
  isPointerLocked: boolean;

  // Actions
  setMode: (mode: CameraMode) => void;
  toggleMode: () => void;
  setPointerLocked: (locked: boolean) => void;
}

export const useCameraStore = create<CameraState>()(
  persist(
    (set) => ({
      // Initial state - default to fly mode (existing behavior)
      mode: 'fly',
      isPointerLocked: false,

      // Set camera mode
      setMode: (mode) => set({ mode }),

      // Toggle between walk and fly
      toggleMode: () => set((state) => ({
        mode: state.mode === 'walk' ? 'fly' : 'walk'
      })),

      // Track pointer lock state
      setPointerLocked: (locked) => set({ isPointerLocked: locked }),
    }),
    {
      name: 'squire-camera-mode',
      partialize: (state) => ({ mode: state.mode }), // Only persist mode
    }
  )
);

// Selector hooks
export const useCameraMode = () => useCameraStore((state) => state.mode);
export const useIsWalkMode = () => useCameraStore((state) => state.mode === 'walk');
export const useIsFlyMode = () => useCameraStore((state) => state.mode === 'fly');
export const useIsPointerLocked = () => useCameraStore((state) => state.isPointerLocked);

// Action selectors
export const useSetCameraMode = () => useCameraStore((state) => state.setMode);
export const useToggleCameraMode = () => useCameraStore((state) => state.toggleMode);
export const useSetPointerLocked = () => useCameraStore((state) => state.setPointerLocked);

// For non-hook contexts
export const cameraActions = {
  setMode: (mode: CameraMode) => useCameraStore.getState().setMode(mode),
  toggleMode: () => useCameraStore.getState().toggleMode(),
  setPointerLocked: (locked: boolean) => useCameraStore.getState().setPointerLocked(locked),
};
