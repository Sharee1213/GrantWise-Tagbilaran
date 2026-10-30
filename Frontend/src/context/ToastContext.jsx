import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback((toast) => {
    const nextToast = {
      id: nextId.current++,
      variant: "success",
      duration: 5000,
      ...toast,
    };

    setToasts((current) => [...current, nextToast].slice(-3));
    return nextToast.id;
  }, []);

  const value = useMemo(
    () => ({
      toasts,
      addToast,
      dismissToast,
    }),
    [addToast, dismissToast, toasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider.");
  }
  return context;
}
