import React from "react";
import ReactDom from "react-dom/client";
import App from "./App.js";
import "bootstrap/dist/css/bootstrap.min.css"; // ✅ Bootstrap


ReactDom.createRoot(document.getElementById("root")).render(
 <React.StrictMode>
    <App />
  </React.StrictMode>



)