import { PERMISSIONS } from "./permissions.js";

const DEBUG = process.env.DEBUG === "1" || process.env.NODE_ENV === "development";

// WebSocket rate limiting
const socketRateLimits = new Map();

function checkSocketRateLimit(socketId, limit = 100, windowMs = 10000) {
  const now = Date.now();
  const key = socketId;
  const entry = socketRateLimits.get(key);

  if (!entry || entry.resetAt <= now) {
    socketRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}

// Cleanup expired socket rate limits every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of socketRateLimits.entries()) {
    if (entry.resetAt <= now) {
      socketRateLimits.delete(key);
    }
  }
}, 60 * 1000);

function sanitizeText(input, maxLen = 2000) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLen);
}

function respondAck(ack, payload) {
  if (typeof ack === "function") {
    ack(payload);
  }
}

function normalizeMessageAttachments(store, channelId, authorId, rawAttachments) {
  const items = Array.isArray(rawAttachments) ? rawAttachments : [];
  const attachments = [];
  const seen = new Set();

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const uploadId = String(item.id || "").trim();
    const uploadUrl = String(item.url || "").trim();
    const upload = uploadId ? store.getUploadById(uploadId) : uploadUrl ? store.getUploadByUrl(uploadUrl) : null;
    if (!upload) continue;
    if (upload.channelId !== channelId || upload.authorId !== authorId) continue;
    if (seen.has(upload.id)) continue;
    seen.add(upload.id);
    attachments.push({
      id: upload.id,
      name: upload.name,
      size: upload.size,
      mimeType: upload.mimeType,
      url: upload.url
    });
  }

  return attachments;
}

export function configureSocket(io, store, sfu) {
  const voiceParticipants = new Map();
  const userVoiceChannel = new Map();
  const speakingUsers = new Map();
  const userSockets = new Map();
  const sessionUsers = new Map();
  const voiceUsersCache = new Map(); // Cache for toVoiceUsers results

  function trackSocket(userId, socket) {
    if (!userId || !socket) return;
    let set = userSockets.get(userId);
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(socket);
    socket.on("disconnect", () => {
      const existing = userSockets.get(userId);
      if (!existing) return;
      existing.delete(socket);
      if (existing.size === 0) {
        userSockets.delete(userId);
      }
    });
  }

  function toVoiceUsers(channelId) {
    const sessionIds = [...(voiceParticipants.get(channelId) || new Set())];

    // Create cache key from sessionIds and speaking state
    const cacheKey = `${channelId}:${sessionIds.sort().join(",")}:${sessionIds.map(id => speakingUsers.get(id) ? "1" : "0").join("")}`;

    // Check cache
    const cached = voiceUsersCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Build result
    const channel = store.getChannelById(channelId);
    const guildId = channel?.guildId;

    // Batch fetch members if possible (optimization for future: add store.getMembersBatch)
    const users = sessionIds.map((sessionId) => {
      const entry = sessionUsers.get(sessionId);
      const userId = entry?.userId;
      const profile = userId ? store.publicUser(userId) : null;
      const member = guildId && userId ? store.getMember(guildId, userId) : null;
      return {
        id: sessionId,
        userId,
        username: profile?.username || entry?.username || (userId ? `User ${String(userId).slice(0, 6)}` : "Unknown"),
        nickname: member?.nickname || "",
        voiceMuted: !!member?.voiceMuted,
        voiceDeafened: !!member?.voiceDeafened
      };
    });

    const speakingUserIds = sessionIds.filter((id) => speakingUsers.get(id) === true);
    const result = { userIds: sessionIds, users, speakingUserIds };

    // Cache result for 5 seconds
    voiceUsersCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + 5000
    });

    // Clean up old cache entries (limit to 100 entries)
    if (voiceUsersCache.size > 100) {
      const now = Date.now();
      for (const [key, entry] of voiceUsersCache.entries()) {
        if (entry.expiresAt <= now) {
          voiceUsersCache.delete(key);
        }
      }
    }

    return result;
  }

  function publishVoicePresence(channelId) {
    const payload = toVoiceUsers(channelId);
    io.to(`voice:${channelId}`).emit("voice:presence", {
      channelId,
      userIds: payload.userIds,
      users: payload.users,
      speakingUserIds: payload.speakingUserIds
    });

    const channel = store.getChannelById(channelId);
    if (channel?.guildId) {
      io.to(`guild:${channel.guildId}`).emit("voice:presenceAll", {
        channelId,
        userIds: payload.userIds,
        users: payload.users,
        speakingUserIds: payload.speakingUserIds
      });
    }
  }

  function publishSpeaking(channelId, participantId, speaking) {
    io.to(`voice:${channelId}`).emit("voice:speaking", {
      channelId,
      userId: participantId,
      speaking: !!speaking
    });

    const channel = store.getChannelById(channelId);
    if (channel?.guildId) {
      io.to(`guild:${channel.guildId}`).emit("voice:speakingAll", {
        channelId,
        userId: participantId,
        speaking: !!speaking
      });
    }
  }

  function setSpeakingState(participantId, speaking) {
    const channelId = userVoiceChannel.get(participantId);
    if (!channelId) return;

    const prev = speakingUsers.get(participantId) === true;
    const next = !!speaking;
    if (prev === next) return;

    speakingUsers.set(participantId, next);
    publishSpeaking(channelId, participantId, next);
  }

  function clearSpeakingState(participantId) {
    const channelId = userVoiceChannel.get(participantId);
    if (!channelId) {
      speakingUsers.delete(participantId);
      return;
    }

    const wasSpeaking = speakingUsers.get(participantId) === true;
    speakingUsers.delete(participantId);
    if (wasSpeaking) {
      publishSpeaking(channelId, participantId, false);
    }
  }

  function cleanupPeer(socket) {
    const roomId = socket.data?.voiceChannelId;
    if (!roomId) return;
    const room = sfu.getRoom(roomId);
    const peer = room?.peers?.get(socket.id);
    if (!peer) return;

    for (const consumer of peer.consumers.values()) {
      try {
        consumer.close();
      } catch {}
    }
    peer.consumers.clear();

    for (const producer of peer.producers.values()) {
      try {
        producer.close();
      } catch {}
      room.producers.delete(producer.id);
      io.to(`voice:${roomId}`).emit("voice:producerClosed", {
        producerId: producer.id,
        peerId: socket.id
      });
    }
    peer.producers.clear();

    for (const transport of peer.transports.values()) {
      try {
        transport.close();
      } catch {}
    }
    peer.transports.clear();

    room.peers.delete(socket.id);
    socket.data.voiceChannelId = null;
  }

  function findRoomForSocket(channelId, socketId) {
    if (channelId) {
      const existing = sfu.rooms.get(channelId);
      if (existing?.peers?.has(socketId)) return existing;
    }
    for (const room of sfu.rooms.values()) {
      if (room?.peers?.has(socketId)) return room;
    }
    return channelId ? sfu.rooms.get(channelId) : null;
  }

  function removeFromVoice(socket) {
    const sessionId = socket?.id;
    if (!sessionId) return;
    const channelId = userVoiceChannel.get(sessionId);
    if (!channelId) return;

    clearSpeakingState(sessionId);
    userVoiceChannel.delete(sessionId);
    const participants = voiceParticipants.get(channelId);
    if (participants) {
      participants.delete(sessionId);
      if (participants.size === 0) {
        voiceParticipants.delete(channelId);
      }
    }

    cleanupPeer(socket);
    socket.leave(`voice:${channelId}`);

    publishVoicePresence(channelId);
  }

  function closeUserAudioProducers(userId) {
    for (const socket of userSockets.get(userId) || []) {
      const channelId = socket.data?.voiceChannelId;
      if (!channelId) continue;
      const room = sfu.getRoom(channelId);
      const peer = room?.peers?.get(socket.id);
      if (!peer) continue;
      for (const producer of peer.producers.values()) {
        const type = producer.appData?.type || "";
        if (producer.kind === "audio" || type === "screen-audio") {
          try {
            producer.close();
          } catch {}
          room.producers.delete(producer.id);
          io.to(`voice:${channelId}`).emit("voice:producerClosed", {
            producerId: producer.id,
            peerId: socket.id
          });
        }
      }
    }
  }

  function moveUserToChannel(userId, channelId) {
    for (const socket of userSockets.get(userId) || []) {
      try {
        socket.emit("voice:move", { channelId });
      } catch {}
    }
  }

  function disconnectUser(userId, reason) {
    const sockets = userSockets.get(userId);
    if (!sockets || sockets.size === 0) return false;
    for (const socket of sockets) {
      try {
        socket.emit("guild:kicked", { reason: reason || "removed" });
      } catch {}
      removeFromVoice(socket);
      try {
        socket.leave(`user:${userId}`);
      } catch {}
      socket.disconnect(true);
    }
    userSockets.delete(userId);
    return true;
  }

  io.on("connection", (socket) => {
    const user = socket.user;
    const userId = user.id;

    if (store.isBanned(userId)) {
      socket.emit("auth:banned", { reason: "banned" });
      socket.disconnect(true);
      return;
    }

    store.upsertProfile(user);

    socket.join(`user:${userId}`);
    trackSocket(userId, socket);
    sessionUsers.set(socket.id, { userId, username: user.username });

    const userGuilds = store.getGuildsForUser(userId);
    for (const guild of userGuilds) {
      socket.join(`guild:${guild.id}`);
    }

    socket.on("guild:joinRoom", (payload = {}) => {
      const guildId = payload.guildId;
      if (!guildId || !store.isGuildMember(guildId, userId)) return;
      socket.join(`guild:${guildId}`);
    });

    socket.on("voice:snapshot", (payload = {}, ack) => {
      const guildId = payload.guildId;
      if (!guildId || !store.isGuildMember(guildId, userId)) {
        respondAck(ack, { error: "Forbidden" });
        return;
      }

      const channels = store
        .getChannelsForGuild(guildId)
        .filter((channel) => channel.type === "voice")
        .map((channel) => {
          const info = toVoiceUsers(channel.id);
          return {
            channelId: channel.id,
            userIds: info.userIds,
            users: info.users,
            speakingUserIds: info.speakingUserIds
          };
        });

      respondAck(ack, { channels });
    });

    socket.on("channel:join", (payload = {}) => {
      const channelId = payload.channelId;
      if (!channelId || !store.isChannelAccessible(channelId, userId)) return;
      socket.join(`channel:${channelId}`);
    });

    socket.on("typing:start", (payload = {}) => {
      const channelId = payload.channelId;
      if (!channelId || !store.isChannelAccessible(channelId, userId)) return;
      const channel = store.getChannelById(channelId);
      if (!channel) return;
      const perms = store.getPermissions(channel.guildId, userId, channelId);
      if ((perms & PERMISSIONS.SEND_MESSAGES) !== PERMISSIONS.SEND_MESSAGES) return;
      socket.to(`channel:${channelId}`).emit("typing:start", {
        channelId,
        user: { id: userId, username: user.username }
      });
    });

    socket.on("typing:stop", (payload = {}) => {
      const channelId = payload.channelId;
      if (!channelId || !store.isChannelAccessible(channelId, userId)) return;
      socket.to(`channel:${channelId}`).emit("typing:stop", {
        channelId,
        userId
      });
    });

    socket.on("message:send", (payload = {}) => {
      const channelId = payload.channelId;
      if (!channelId || !store.isChannelAccessible(channelId, userId)) return;

      const channel = store.getChannelById(channelId);
      if (!channel || channel.type !== "text") return;
      const perms = store.getPermissions(channel.guildId, userId, channelId);
      if ((perms & PERMISSIONS.SEND_MESSAGES) !== PERMISSIONS.SEND_MESSAGES) return;

      const content = sanitizeText(payload.content || "");
      const attachments = normalizeMessageAttachments(store, channelId, userId, payload.attachments);
      const replyToId = typeof payload.replyToId === "string" ? payload.replyToId.trim() : "";
      if (replyToId) {
        const reply = store.getMessageById(replyToId);
        if (!reply || reply.channelId !== channelId) return;
      }

      if (!content && attachments.length === 0) return;

      const message = store.createMessage({
        channelId,
        authorId: userId,
        content,
        attachments,
        replyToId: replyToId || null
      });

      const view = store.toMessageView(message);
      io.to(`channel:${channelId}`).emit("message:new", view);
    });

    socket.on("voice:join", (payload = {}, ack) => {
      // Rate limit voice joins - max 10 per minute
      if (!checkSocketRateLimit(`voice:join:${userId}`, 10, 60000)) {
        respondAck(ack, { error: "Too many join attempts. Please slow down." });
        return;
      }

      const channelId = payload.channelId;
      if (DEBUG) console.log(`[voice:join] User ${userId} attempting to join channel ${channelId}`);
      if (!channelId || !store.isChannelAccessible(channelId, userId)) {
        if (DEBUG) console.log(`[voice:join] Forbidden - channelId: ${channelId}, accessible: ${store.isChannelAccessible(channelId, userId)}`);
        respondAck(ack, { error: "Forbidden" });
        return;
      }

      const channel = store.getChannelById(channelId);
      if (!channel || channel.type !== "voice") {
        if (DEBUG) console.log(`[voice:join] Not a voice channel - channel exists: ${!!channel}, type: ${channel?.type}`);
        respondAck(ack, { error: "Not a voice channel" });
        return;
      }
      const perms = store.getPermissions(channel.guildId, userId, channelId);
      if ((perms & PERMISSIONS.VOICE_CONNECT) !== PERMISSIONS.VOICE_CONNECT) {
        if (DEBUG) console.log(`[voice:join] Missing voice permission - perms: ${perms}, required: ${PERMISSIONS.VOICE_CONNECT}`);
        respondAck(ack, { error: "Missing voice permission" });
        return;
      }

      removeFromVoice(socket);
      if (DEBUG) console.log(`[voice:join] User ${userId} successfully joined channel ${channelId}`);

      if (!voiceParticipants.has(channelId)) {
        voiceParticipants.set(channelId, new Set());
      }

      voiceParticipants.get(channelId).add(socket.id);
      userVoiceChannel.set(socket.id, channelId);
      socket.data.voiceChannelId = channelId;
      socket.join(`voice:${channelId}`);

      const room = sfu.getRoom(channelId);
      room.peers.set(socket.id, {
        socketId: socket.id,
        userId,
        channelId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      });

      const payloadOut = toVoiceUsers(channelId);
      const peerIds = payloadOut.userIds.filter((id) => id !== socket.id);
      const peers = payloadOut.users.filter((member) => member.id !== socket.id);
      const speakingPeerIds = payloadOut.speakingUserIds.filter((id) => id !== socket.id);

      socket.emit("voice:participants", {
        channelId,
        userIds: peerIds,
        users: peers,
        speakingUserIds: speakingPeerIds
      });

      const existingProducers = [];
      for (const [producerId, entry] of room.producers.entries()) {
        if (entry.peerId === socket.id) continue;
        existingProducers.push({
          producerId,
          peerId: entry.peerId,
          kind: entry.producer.kind,
          appData: { ...(entry.producer.appData || {}), userId: entry.userId }
        });
      }

      if (existingProducers.length) {
        socket.emit("voice:existingProducers", {
          channelId,
          producers: existingProducers
        });
      }

      publishVoicePresence(channelId);
      respondAck(ack, { ok: true, channelId });
    });

    socket.on("voice:leave", () => {
      const previousChannelId = userVoiceChannel.get(socket.id);
      removeFromVoice(socket);
      if (previousChannelId) {
        socket.leave(`voice:${previousChannelId}`);
      }
    });

    socket.on("voice:getRouterRtpCapabilities", (_, ack) => {
      if (DEBUG) console.log(`[voice:getRouterRtpCapabilities] User ${userId} requesting RTP capabilities`);
      respondAck(ack, { rtpCapabilities: sfu.router.rtpCapabilities });
    });

    socket.on("voice:createSendTransport", async (payload = {}, ack) => {
      try {
        const channelId = payload.channelId || socket.data.voiceChannelId;
        if (DEBUG) console.log(`[voice:createSendTransport] User ${userId} creating send transport for channel ${channelId}`);
        const room = findRoomForSocket(channelId, socket.id);
        const peer = room?.peers?.get(socket.id);
        if (!peer) {
          if (DEBUG) console.log(`[voice:createSendTransport] Peer not found for socket ${socket.id} in channel ${channelId}`);
          respondAck(ack, { error: "Not in voice channel" });
          return;
        }

        const transport = await sfu.createWebRtcTransport();
        peer.transports.set(transport.id, transport);
        if (DEBUG) console.log(`[voice:createSendTransport] Send transport created: ${transport.id}`);

        respondAck(ack, {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        });
      } catch (error) {
        console.error(`[voice:createSendTransport] Error:`, error);
        respondAck(ack, { error: error?.message || "Failed to create transport" });
      }
    });

    socket.on("voice:createRecvTransport", async (payload = {}, ack) => {
      try {
        const channelId = payload.channelId || socket.data.voiceChannelId;
        if (DEBUG) console.log(`[voice:createRecvTransport] User ${userId} creating receive transport for channel ${channelId}`);
        const room = findRoomForSocket(channelId, socket.id);
        const peer = room?.peers?.get(socket.id);
        if (!peer) {
          if (DEBUG) console.log(`[voice:createRecvTransport] Peer not found for socket ${socket.id} in channel ${channelId}`);
          respondAck(ack, { error: "Not in voice channel" });
          return;
        }

        const transport = await sfu.createWebRtcTransport();
        peer.transports.set(transport.id, transport);
        if (DEBUG) console.log(`[voice:createRecvTransport] Receive transport created: ${transport.id}`);

        respondAck(ack, {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters
        });
      } catch (error) {
        console.error(`[voice:createRecvTransport] Error:`, error);
        respondAck(ack, { error: error?.message || "Failed to create transport" });
      }
    });

    socket.on("voice:connectTransport", async (payload = {}, ack) => {
      try {
        const transportId = payload.transportId;
        const dtlsParameters = payload.dtlsParameters;
        const channelId = payload.channelId || socket.data.voiceChannelId;
        const room = findRoomForSocket(channelId, socket.id);
        const peer = room?.peers?.get(socket.id);
        const transport = peer?.transports?.get(transportId);
        if (!transport) {
          respondAck(ack, { error: "Transport not found" });
          return;
        }
        await transport.connect({ dtlsParameters });
        respondAck(ack, { ok: true });
      } catch (error) {
        respondAck(ack, { error: error?.message || "Failed to connect transport" });
      }
    });

    socket.on("voice:produce", async (payload = {}, ack) => {
      try {
        const { transportId, kind, rtpParameters, appData } = payload;
        const channelId = payload.channelId || socket.data.voiceChannelId;
        const room = findRoomForSocket(channelId, socket.id);
        const peer = room?.peers?.get(socket.id);
        const transport = peer?.transports?.get(transportId);
        if (!transport) {
          respondAck(ack, { error: "Transport not found" });
          return;
        }
        const channel = store.getChannelById(channelId);
        const perms = channel ? store.getPermissions(channel.guildId, userId, channelId) : 0;
        const appType = appData?.type || "";
        if (kind === "audio") {
          if ((perms & PERMISSIONS.VOICE_SPEAK) !== PERMISSIONS.VOICE_SPEAK) {
            respondAck(ack, { error: "Missing voice permission" });
            return;
          }
          const member = channel ? store.getMember(channel.guildId, userId) : null;
          if (member?.voiceMuted) {
            respondAck(ack, { error: "You are muted" });
            return;
          }
        }
        if (kind === "video" || appType === "screen" || appType === "screen-audio") {
          if ((perms & PERMISSIONS.SCREENSHARE) !== PERMISSIONS.SCREENSHARE) {
            respondAck(ack, { error: "Missing screenshare permission" });
            return;
          }
        }

        const producer = await transport.produce({
          kind,
          rtpParameters,
          appData: { ...(appData || {}), peerId: socket.id, userId }
        });

        peer.producers.set(producer.id, producer);
        room.producers.set(producer.id, {
          producer,
          peerId: socket.id,
          userId
        });

        producer.on("transportclose", () => {
          peer.producers.delete(producer.id);
          room.producers.delete(producer.id);
        });

        socket.to(`voice:${channelId}`).emit("voice:newProducer", {
          producerId: producer.id,
          peerId: socket.id,
          kind: producer.kind,
          appData: { ...(producer.appData || {}), userId }
        });

        respondAck(ack, { id: producer.id });
      } catch (error) {
        respondAck(ack, { error: error?.message || "Failed to produce" });
      }
    });

    socket.on("voice:closeProducer", (payload = {}) => {
      const producerId = payload.producerId;
      const channelId = payload.channelId || socket.data.voiceChannelId;
      const room = channelId ? sfu.getRoom(channelId) : null;
      const peer = room?.peers?.get(socket.id);
      const producer = peer?.producers?.get(producerId);
      if (!producer) return;
      try {
        producer.close();
      } catch {}
      peer.producers.delete(producerId);
      room.producers.delete(producerId);
      io.to(`voice:${channelId}`).emit("voice:producerClosed", {
        producerId,
        peerId: socket.id
      });
    });

    socket.on("voice:consume", async (payload = {}, ack) => {
      try {
        const { producerId, rtpCapabilities, transportId } = payload;
        const channelId = payload.channelId || socket.data.voiceChannelId;
        const room = findRoomForSocket(channelId, socket.id);
        const peer = room?.peers?.get(socket.id);
        const transport = peer?.transports?.get(transportId);
        if (!transport) {
          respondAck(ack, { error: "Transport not found" });
          return;
        }

        const producerEntry = room?.producers?.get(producerId);
        if (!producerEntry) {
          respondAck(ack, { error: "Producer not found" });
          return;
        }

        if (!sfu.router.canConsume({ producerId, rtpCapabilities })) {
          respondAck(ack, { error: "Cannot consume" });
          return;
        }

        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
          appData: producerEntry.producer.appData || {}
        });

        peer.consumers.set(consumer.id, consumer);

        consumer.on("transportclose", () => {
          peer.consumers.delete(consumer.id);
        });

        consumer.on("producerclose", () => {
          peer.consumers.delete(consumer.id);
          socket.emit("voice:producerClosed", {
            producerId,
            peerId: producerEntry.peerId
          });
        });

        respondAck(ack, {
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          appData: consumer.appData || {},
          peerId: producerEntry.peerId
        });
      } catch (error) {
        respondAck(ack, { error: error?.message || "Failed to consume" });
      }
    });

    socket.on("voice:resumeConsumer", async (payload = {}, ack) => {
      try {
        const channelId = payload.channelId || socket.data.voiceChannelId;
        const room = findRoomForSocket(channelId, socket.id);
        const peer = room?.peers?.get(socket.id);
        const consumer = peer?.consumers?.get(payload.consumerId);
        if (!consumer) {
          respondAck(ack, { error: "Consumer not found" });
          return;
        }
        await consumer.resume();
        respondAck(ack, { ok: true });
      } catch (error) {
        respondAck(ack, { error: error?.message || "Failed to resume consumer" });
      }
    });

    socket.on("voice:speaking", (payload = {}) => {
      const channelId = payload.channelId;
      if (!channelId || !store.isChannelAccessible(channelId, userId)) return;

      const activeChannel = userVoiceChannel.get(socket.id);
      if (activeChannel !== channelId) return;

      const channel = store.getChannelById(channelId);
      const perms = channel ? store.getPermissions(channel.guildId, userId, channelId) : 0;
      if ((perms & PERMISSIONS.VOICE_SPEAK) !== PERMISSIONS.VOICE_SPEAK) {
        setSpeakingState(socket.id, false);
        return;
      }
      setSpeakingState(socket.id, payload.speaking === true);
    });

    socket.on("disconnect", () => {
      removeFromVoice(socket);
      sessionUsers.delete(socket.id);
    });
  });

  return {
    disconnectUser,
    forceMuteUser: closeUserAudioProducers,
    moveUser: moveUserToChannel
  };
}
