const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8"
    });
    res.end("ok");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws, req) => {
    ws.send_object = function(object) {
        ws.send(JSON.stringify(object));
    }
    ws.close_connection = function(reason) {
        ws.send_object({
            type: "close",
            reason,
        });
    }
    //----------------
    ws.send_object({
        type: "waitingForUsername"
    });

    ws.on("message", (data, isBinary) => {
        if (isBinary) { 
            console.log("Got binary data:", data.length, "byte");
            return;
        }
        let json = {};
        try {
            json = JSON.parse(data)
            if (json.type === "givingUsername") {
                broadcast({type: "someIsOnline", username: json.username})
            } else if (json.type === "") {
                
            }
        } catch (err) {
            console.log("Error to parse",json)
        }
    });

    ws.on("close", () => {
        console.log("Client disconnected");
    });

    ws.on("error", (err) => {
        console.error("WebSocket error:", err.message);
    });
});

// Рассылка всем подключённым клиентам
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
