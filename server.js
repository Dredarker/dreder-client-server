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

wss.on("connection", (ws, req) => {
    ws.playerid = Math.ceil(Math.random()*999999999);
    players.set(ws.playerid, {
        nickname: "",
        role: "not_logged",
    });
    ws.player = players.get(ws.playerid)
    //---------------
    ws.send_object = function(object) {
        ws.send(JSON.stringify(object));
    }
    ws.close_connection = function(reason) {
        ws.send_object({
            type: "close",
            reason,
        });
        ws.close();
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
                } else {
                    ws.player.role = "member";
                }
                ws.player.nickname = json.username;
                ws.send_object({type: "connected"});
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
            } else {
                ws.close_connection("unalled_command")
                return;
            }
        }
    });

    ws.on("close", () => {
        broadcast({type: "userIsOffline", username: ws.player.nickname});
        players.delete(ws.playerid);
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });
});

function broadcast(object) {
    const message = JSON.stringify(object);
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

server.listen(PORT, "0.0.0.0", () => {
    console.log(`HTTP and WebSocket server started an port ${PORT}`);
});
