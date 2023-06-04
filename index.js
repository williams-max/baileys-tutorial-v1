const {
  default: makeWASocket,
  MessageType,
  MessageOptions,
  Mimetype,
  DisconnectReason,
  BufferJSON,
  AnyMessageContent,
  delay,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  makeInMemoryStore,
  MessageRetryMap,
  useMultiFileAuthState,
  msgRetryCounterMap,
} = require("@adiwajshing/baileys");

const log = (pino = require("pino"));
const { session } = { session: "session_auth_info" };
const { Boom } = require("@hapi/boom");
const path = require("path");
const fs = require("fs");
//const http = require("http");
//const https = require("https");
const express = require("express");
const fileUpload = require("express-fileupload");
const cors = require("cors");
const bodyParser = require("body-parser");
const app = require("express")();
// enable files upload
app.use(
  fileUpload({
    createParentPath: true,
  })
);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const server = require("http").createServer(app);
const io = require("socket.io")(server);

const port = process.env.PORT || 8000;
const qrcode = require("qrcode");

app.use("/assets", express.static(__dirname + "/client/assets"));

app.get("/scan", (req, res) => {
  res.sendFile("./client/index.html", {
    root: __dirname,
  });
});

app.get("/", (req, res) => {
  res.send("server working");
});

const store = makeInMemoryStore({
  logger: pino().child({ level: "silent", stream: "store" }),
});

let sock;
let qrDinamic;
let soket;


async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("session_auth_info");

  sock = makeWASocket({
    printQRInTerminal: true, //true
    auth: state,
    logger: log({ level: "silent" }),
  });

  store.bind(sock.ev);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    qrDinamic = qr;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      if (reason === DisconnectReason.badSession) {
        console.log(
          `Bad Session File, Please Delete ${session} and Scan Again`
        );
        sock.logout();
      } else if (reason === DisconnectReason.connectionClosed) {
        console.log("Connection closed, reconnecting....");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionLost) {
        console.log("Connection Lost from Server, reconnecting...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.connectionReplaced) {
        console.log(
          "Connection Replaced, Another New Session Opened, Please Close Current Session First"
        );
        sock.logout();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(
          `Device Logged Out, Please Delete ${session} and Scan Again.`
        );
        sock.logout();
      } else if (reason === DisconnectReason.restartRequired) {
        console.log("Restart Required, Restarting...");
        connectToWhatsApp();
      } else if (reason === DisconnectReason.timedOut) {
        console.log("Connection TimedOut, Reconnecting...");
        connectToWhatsApp();
      } else {
        sock.end(`Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`);
      }
    } else if (connection === "open") {
      console.log("opened connection");
      let getGroups = await sock.groupFetchAllParticipating();

      //console.log(groups);
      return;
    }
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    try {
      if (type === "notify") {
        if (!messages[0]?.key.fromMe) {
          //especifique el tipo de mensaje de texto
          const caprtureMessage = messages[0]?.message?.conversation;

          // ahora el remitente del mensaje como id
          const numberWa = messages[0]?.key?.remoteJid;

          const campareMessage = caprtureMessage.toLowerCase();

          if (campareMessage === "ping") {
            await sock.sendMessage(
              numberWa,
              { text: "Pong" },
              { quoted: messages[0] }
            );
          } else {
            await sock.sendMessage(
              numberWa,
              { text: "soy un robot!" },
              { quoted: messages[0] }
            );
          }
        }
      }
    } catch (error) {
      console.log("error ", error);
    }
  });
}

io.on("connection", async (socket) => {
  soket = socket;
  if (isConnected()) {
    updateQR("connected");
  } else if (qrDinamic) {
    updateQR("qr");
  }
});


const isConnected = () => {
  return sock?.user ? true : false;
};


const updateQR = (data) => {
  switch (data) {
    case "qr":
      qrcode.toDataURL(qrDinamic, (err, url) => {
    
        soket?.emit("qr", url);
        soket?.emit("log", "QR Code received, please scan!");
      });

      break;
    case "connected":
 
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", "WhatsApp connected!");
      const { id, name } = sock?.user;

      var userinfo = id + " " + name;

      soket?.emit("user", userinfo);

      break;
    case "qrscanned":
      soket?.emit("qrstatus", "./assets/check.svg");
      soket?.emit("log", "QR Code has been scanned!");
      break;
    case "loading":
      soket?.emit("qrstatus", "./assets/loader.gif");
      soket?.emit("log", "Registering QR Code , please wait!");
      break;
    default:
      break;
  }
};

app.get("/scan-qr", async (req, res) => {
  try {
    if (!isConnected()) {
      qrcode.toDataURL(qrDinamic, (err, url) => {
        res.status(200).json({
          status: true,
          qrUrl: url,
        });
      });
    } else {
      //qr null user conected

      res.status(200).json({
        status: false,
        message: "user coneted",
      });
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

app.get("/send-message", async (req, res) => {
  //  http://localhost:8000/send-message?number=76997086&message=ok
  
  const tempMessage = req.query.message;
  const number = req.query.number;

  let numberWA;
  try {
    if (!number) {
      res.status(500).json({
        status: false,
        response: "¡El número WA no ha sido incluido!",
      });
    } else {

      numberWA = "591" + number + "@s.whatsapp.net";
   
      if (isConnected()) {
        const exists = await sock.onWhatsApp(numberWA);
        if (exists?.jid || (exists && exists[0]?.jid)) {
          sock
            .sendMessage(exists.jid || exists[0].jid, { text: tempMessage })
            .then((result) => {
              res.status(200).json({
                status: true,
                response: result,
              });
            })
            .catch((err) => {
              res.status(500).json({
                status: false,
                response: err,
              });
            });
        } else {
          res.status(500).json({
            status: false,
            response: `El número ${number} no está registrado.`,
          });
        }
      } else {
        res.status(500).json({
          status: false,
          response: `WhatsApp aún no está conectado.`,
        });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post("/send-message", async (req, res) => {
 
  const tempMessage = req.body.message;
  const number = req.body.number;

  let numberWA;
  try {
    if (!number) {
      res.status(500).json({
        status: false,
        response: "¡El número WA no ha sido incluido!",
      });
    } else {
    
      numberWA = "591" + number + "@s.whatsapp.net";
      console.log(await sock.onWhatsApp(numberWA));
      if (isConnected()) {
        const exists = await sock.onWhatsApp(numberWA);
        if (exists?.jid || (exists && exists[0]?.jid)) {
          sock
            .sendMessage(exists.jid || exists[0].jid, { text: tempMessage })
            .then((result) => {
              res.status(200).json({
                status: true,
                response: result,
              });
            })
            .catch((err) => {
              res.status(500).json({
                status: false,
                response: err,
              });
            });
        } else {
          res.status(500).json({
            status: false,
            response: `El número ${number} no está registrado.`,
          });
        }
      } else {
        res.status(500).json({
          status: false,
          response: `WhatsApp aún no está conectado.`,
        });
      }
    }
  } catch (err) {
    res.status(500).send(err);
  }
});


connectToWhatsApp().catch((err) => console.log("unexpected error: " + err)); // catch any errors
server.listen(port, () => {
  console.log("Server Run Port : " + port);
});
