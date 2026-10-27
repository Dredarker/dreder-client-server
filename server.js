const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const players = new Map();
const voiceRooms = new Map();

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end("ok");
});

const wss = new WebSocket.Server({
    server,
    maxPayload: 64 * 1024,
});

const config = {
    timeoutSecMax: 60,
    timeoutSecRepeat: 20,
};

function sendObject(ws, object) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(object));
    }
}

function roomMembers(roomId) {
    return voiceRooms.get(roomId) || new Set();
}

function sendToVoiceRoom(roomId, object, exceptId = null) {
    for (const playerId of roomMembers(roomId)) {
        if (playerId === exceptId) continue;
        const client = players.get(playerId)?.ws;
        if (client && client.readyState === WebSocket.OPEN) {
            sendObject(client, object);
        }
    }
}

function leaveVoiceRoom(ws) {
    const roomId = ws.player?.voiceRoom;
    if (!roomId) return;

    const members = voiceRooms.get(roomId);
    if (members) {
        members.delete(ws.playerid);
        if (members.size === 0) voiceRooms.delete(roomId);
    }

    ws.player.voiceRoom = null;
    sendToVoiceRoom(roomId, {
        type: "voicePeerLeft",
        id: String(ws.playerid),
    });
}

function joinVoiceRoom(ws, shipId) {
    if (typeof shipId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(shipId)) {
        sendObject(ws, { type: "voiceError", reason: "invalid_ship_id" });
        return;
    }

    const roomId = `ship:${shipId}`;
    if (ws.player.voiceRoom === roomId) {
        const peers = [...roomMembers(roomId)]
            .filter(id => id !== ws.playerid)
            .map(id => ({
                id: String(id),
                nickname: players.get(id)?.nickname || "Unknown",
            }));
        sendObject(ws, { type: "voiceRoomJoined", room: roomId, peers });
        return;
    }

    leaveVoiceRoom(ws);

    if (!voiceRooms.has(roomId)) voiceRooms.set(roomId, new Set());
    const members = voiceRooms.get(roomId);
    const peers = [...members].map(id => ({
        id: String(id),
        nickname: players.get(id)?.nickname || "Unknown",
    }));

    members.add(ws.playerid);
    ws.player.voiceRoom = roomId;
    ws.player.shipId = shipId;

    sendObject(ws, {
        type: "voiceRoomJoined",
        room: roomId,
        peers,
    });

    sendToVoiceRoom(roomId, {
        type: "voicePeerJoined",
        id: String(ws.playerid),
        nickname: ws.player.nickname,
    }, ws.playerid);
}

function broadcast(object) {
    for (const ws of wss.clients) {
        if (
            ws.readyState === WebSocket.OPEN
            && ws.player
            && ws.player.role !== "not_logged"
        ) {
            sendObject(ws, object);
        }
    }
}

setInterval(() => {
    for (const ws of wss.clients) {
        if (!ws.player || ws.readyState !== WebSocket.OPEN) continue;

        const sec = ++ws.player.timeoutSec;
        if (sec >= config.timeoutSecMax) {
            ws.close_connection("timeout");
        } else if (sec % config.timeoutSecRepeat === 0) {
            ws.player.pongCount++;
            sendObject(ws, { type: "pong" });
        }
    }
}, 1000);

wss.on("connection", (ws) => {
    ws.playerid = String(Math.ceil(Math.random() * 999999999));
    while (players.has(ws.playerid)) {
        ws.playerid = String(Math.ceil(Math.random() * 999999999));
    }

    ws.player = {
        id: ws.playerid,
        nickname: "",
        role: "not_logged",
        timeoutSec: 0,
        pongCount: 0,
        closereason: "closed_not_by_server",
        voiceRoom: null,
        shipId: null,
        ws,
    };
    players.set(ws.playerid, ws.player);

    ws.send_object = object => sendObject(ws, object);
    ws.close_connection = reason => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.player.closereason = reason;
        sendObject(ws, { type: "close", reason });
        ws.close();
    };
    ws.fake_close_connection = reason => {
        broadcast({
            type: "userIsOffline",
            id: ws.playerid,
            username: ws.player.nickname,
            reason,
        });
        sendObject(ws, { type: "close", reason: "fake_" + reason });
    };

    sendObject(ws, { type: "waitingForData" });

    ws.on("message", (data, isBinary) => {
        if (isBinary) {
            ws.close_connection("binary_not_supported");
            return;
        }
        if (data.length > 64 * 1024) {
            ws.close_connection("too_long_data");
            return;
        }

        let json;
        try {
            json = JSON.parse(data.toString());
        } catch {
            ws.close_connection("not_json");
            return;
        }

        if (!json || typeof json.type !== "string") {
            ws.close_connection("invalid_message");
            return;
        }

        if (ws.player.role === "not_logged") {
            if (json.type !== "givingData") {
                ws.close_connection("unallowed_command_while_not_logged");
                return;
            }

            if (typeof json.username !== "string" || !json.username.trim() || json.username.length > 64) {
                ws.close_connection("empty_or_invalid_username");
                return;
            }

            if (json.password === process.env.password && process.env.password) {
                ws.player.role = "admin";
            } else if (json.password !== "") {
                ws.close_connection("wrong_password");
                return;
            } else {
                ws.player.role = "member";
            }

            ws.player.nickname = json.username.trim();
            sendObject(ws, { type: "connected", id: ws.playerid });
            broadcast({
                type: "userIsOnline",
                id: ws.playerid,
                data: { nickname: ws.player.nickname },
            });
            return;
        }

        if (json.type === "getPlayers") {
            const objplayers = {};
            players.forEach((player, id) => {
                objplayers[id] = { nickname: player.nickname };
            });
            sendObject(ws, { type: "getPlayers", players: objplayers });
        } else if (json.type === "ping") {
            if (ws.player.pongCount <= 0) {
                ws.close_connection("too_early_to_ping");
                return;
            }
            ws.player.timeoutSec = 0;
            ws.player.pongCount--;
        } else if (json.type === "voiceJoin") {
            joinVoiceRoom(ws, json.shipId);
        } else if (json.type === "voiceLeave") {
            leaveVoiceRoom(ws);
        } else if (json.type === "voiceSignal") {
            const targetId = String(json.target || "");
            const target = players.get(targetId);
            if (
                !ws.player.voiceRoom
                || !target
                || target.voiceRoom !== ws.player.voiceRoom
                || !json.signal
                || typeof json.signal !== "object"
            ) {
                sendObject(ws, { type: "voiceError", reason: "invalid_signal_target" });
                return;
            }

            // Only WebRTC signaling data is relayed; audio travels over WebRTC.
            sendObject(target.ws, {
                type: "voiceSignal",
                from: ws.playerid,
                signal: json.signal,
            });
        } else if (json.type === "exec_server" && ws.player.role === "admin") {
            // Kept for compatibility with the existing admin-only client command.
            let result;
            try {
                result = eval(json.code);
            } catch (error) {
                result = { error: error.message };
            }
            sendObject(ws, { type: "exec_server_result", result });
        } else {
            ws.close_connection("unallowed_command");
        }
    });

    ws.on("close", () => {
        leaveVoiceRoom(ws);
        broadcast({
            type: "userIsOffline",
            id: ws.playerid,
            reason: ws.player.closereason,
        });
        players.delete(ws.playerid);
    });

    ws.on("error", err => {
        console.error("WebSocket error:", err.message);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP and WebSocket server started on port ${PORT}`);
});
