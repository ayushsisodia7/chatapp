import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
 root: __dirname,
 plugins: [react()],
 server: {
 port: 3000,
 strictPort: false,
 },
 optimizeDeps: {
 include: [
 "@cometchat/chat-sdk-javascript",
 "@cometchat/chat-uikit-react",
 ],
 },
});
