const { contextBridge, desktopCapturer, ipcRenderer } = require("electron");

async function fetchSourcesViaMain() {
  return ipcRenderer.invoke("remus:get-screen-sources");
}

contextBridge.exposeInMainWorld("remusDesktop", {
  app: "Remus",
  platform: process.platform,
  electron: process.versions.electron,
  getScreenSources: async () => {
    if (desktopCapturer && typeof desktopCapturer.getSources === "function") {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        fetchWindowIcons: true
      });
      return sources.map((source) => ({
        id: source.id,
        name: source.name
      }));
    }
    return fetchSourcesViaMain();
  }
});
