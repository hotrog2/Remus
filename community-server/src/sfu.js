import * as mediasoup from "mediasoup";

const DEFAULT_MEDIA_CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: {}
  }
];

function toPort(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

export async function createSfu({
  listenIp = "0.0.0.0",
  announcedIp = "",
  rtcMinPort = 40000,
  rtcMaxPort = 49999
} = {}) {
  const worker = await mediasoup.createWorker({
    rtcMinPort: toPort(rtcMinPort, 40000),
    rtcMaxPort: toPort(rtcMaxPort, 49999)
  });

  worker.on("died", () => {
    console.error("Mediasoup worker died, exiting.");
    process.exit(1);
  });

  const router = await worker.createRouter({ mediaCodecs: DEFAULT_MEDIA_CODECS });
  const rooms = new Map();

  function getRoom(channelId) {
    if (!rooms.has(channelId)) {
      rooms.set(channelId, {
        id: channelId,
        peers: new Map(),
        producers: new Map()
      });
    }
    return rooms.get(channelId);
  }

  async function createWebRtcTransport() {
    return router.createWebRtcTransport({
      listenIps: [
        {
          ip: listenIp,
          announcedIp: announcedIp || undefined
        }
      ],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    });
  }

  return {
    worker,
    router,
    rooms,
    getRoom,
    createWebRtcTransport
  };
}
