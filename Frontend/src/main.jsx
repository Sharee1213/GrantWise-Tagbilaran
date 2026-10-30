import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import ToastRegion from "./components/ToastRegion.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { ToastProvider } from "./context/ToastContext.jsx";
import "./styles.css";

document.documentElement.classList.add("js");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <ThemeProvider>
          <App />
          <ToastRegion />
        </ThemeProvider>
      </BrowserRouter>
    </ToastProvider>
  </React.StrictMode>,
);
