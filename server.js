const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const players = new Map();

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
        let json = {};
        try {
            json = JSON.parse(data);
        } catch (err) {
            console.log("Error to parse",json);
            ws.close_connection("DoS");
            return;
        }

        if (ws.player.role === "not_logged") {
            if (json.type === "givingData") {
                if (json.password === process.env.password) {
                    ws.player.role = "admin";
                } else if (json.password !== "") {
                    ws.close_connection("wrong_password")
                    return;
                } else if (json.username === "") {
                    ws.close_connection("empty_username")
                    return;
                } else {
                    ws.player.role = "member";
                }
                ws.player.nickname = json.username;
                ws.send_object({
                    type: "connected",
                });
                broadcast({type: "userIsOnline", username: ws.player.nickname});
            } else {
                ws.close_connection("unalled_command_while_not_logged")
                return;
            }
        } else {
            if (json.type === "getPlayers") {
                let array = [];
                players.forEach((data,id) => {
                    array.push(data.nickname);
                });
                ws.send_object({
                    type: "getPlayers",
                    array,
                });
            } else if (json.type === "ping") {
                if (ws.player.pongCount <= 0) ws.close_connection("too_early_to_ping")
                ws.player.timeoutSec = 0;
                ws.player.pongCount--;
            } else if (json.type === "exec_server" && ws.player.role === "admin") {
                let result = eval(json.code);
                ws.send_object({
                    type: "exec_server_result",
                    result,
                });
            } else {
                ws.close_connection("unalled_command")
                return;
            }
        }
    });

    ws.on("close", () => {
        broadcast({
            type: "userIsOffline",
            username: ws.player.nickname,
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

server.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP and WebSocket server started an port ${PORT}`);
});
