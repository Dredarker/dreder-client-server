const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const players = new Map();
const rooms = new Map();

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });
    res.end("ok");
});

const wss = new WebSocket.Server({ server });

const config = {
    timeoutSecMax: 60,
    timeoutSecRepeat: 20,
};

setInterval(() => {
    wss.clients.forEach((ws,id) => {
        let sec = ++ws.player.timeoutSec;
        if (sec >= config.timeoutSecMax) {
            ws.close_connection("timeout");
        } else if (sec % config.timeoutSecRepeat == 0 && sec / config.timeoutSecRepeat != 0) {
            ws.player.pongCount++;
            ws.send_object({type: "pong"});
        }
    })
}, 1000)

wss.on("connection", (ws, req) => {
    ws.playerid = Math.ceil(Math.random()*999999999);
    players.set(ws.playerid, {
        nickname: "",
        role: "not_logged",

        timeoutSec: 0,
        pongCount: 0,
        closereason: "closed_not_by_server",
    });
    ws.player = players.get(ws.playerid)
    //---------------
    ws.send_object = function(object) {
        this.send(JSON.stringify(object));
    }
    ws.close_connection = function(reason) {
        this.player.closereason = reason;
        this.send_object({
            type: "close",
            reason,
        });
        this.close();
    }
    ws.fake_close_connection = function(reason) {
        broadcast({
            type: "userIsOffline",
            username: this.player.nickname,
            reason,
        });
        this.send_object({
            type: "close",
            reason: "fake_"+reason,
        });
    }
    //----------------
    ws.send_object({
        type: "waitingForData"
    });

    ws.on("message", (data, isBinary) => {
        if (
            data.length > 1000
            && role !== "admin"
        ) {
            return ws.close_connection("too_long_data");
        }
        let json = {};
        try {
            json = JSON.parse(data);
        } catch (err) {
            console.log("Error to parse",json);
            return ws.close_connection("not_json");
        }

        if (ws.player.role === "not_logged") {
            if (json.type === "givingData") {
                if (json.password === process.env.password) {
                    ws.player.role = "admin";
                } else if (json.password !== "") {
                    return ws.close_connection("wrong_password")
                } else if (json.username === "") {
                    return ws.close_connection("empty_username")
                } else {
                    ws.player.role = "member";
                }
                ws.player.nickname = json.username;
                ws.send_object({
                    type: "connected",
                });
                broadcast({type: "userIsOnline", id: ws.playerid, data: {
                    nickname: ws.player.nickname
                }});
            } else {
                return ws.close_connection("unalled_command_while_not_logged")
            }
        } else {
            if (json.type === "getPlayers") {
                let objplayers = {};
                players.forEach((data,id) => {
                    objplayers[id] = {nickname: data.nickname};
                });
                ws.send_object({
                    type: "getPlayers",
                    players: objplayers,
                });
            } else if (json.type === "ping") {
                if (ws.player.pongCount <= 0) ws.close_connection("too_early_to_ping")
                ws.player.timeoutSec = 0;
                ws.player.pongCount--;
            } else if (json.type === "room") {
                if (json.subtype === "join_or_create") {
                    // on create/join room...
                } else {
                    return ws.close_connection("unalled_subcommand")
                }
            } else if (json.type === "exec_server" && ws.player.role === "admin") {
                let result = eval(json.code);
                ws.send_object({
                    type: "exec_server_result",
                    result,
                });
            } else {
                return ws.close_connection("unalled_command")
            }
        }
    });

    ws.on("close", () => {
        broadcast({
            type: "userIsOffline",
            id: ws.playerid,
            reason: ws.player.closereason,
        });
        players.delete(ws.playerid);
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });
});

function broadcast(object) {
    const message = JSON.stringify(object);
    wss.clients.forEach((ws,id) => {
        if (
            ws.readyState === WebSocket.OPEN
            && ws.role !== "not_logged"
        ) {
            ws.send(message);
        }
    })
}

function mapFromObj(obj) {
    return new Map(Object.entries(obj));
}

function objFromMap(map) {
    return Object.fromEntries(map.entries());
}

server.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP and WebSocket server started an port ${PORT}`);
});
