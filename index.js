require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const express = require("express");
const http = require("http");

// Configuración
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const app = express();
const PORT = process.env.PORT || 3000;
const CHANNEL_NAME = process.env.CHANNEL_NAME;
const MIN_PRICE = parseInt(process.env.MIN_PRICE);
const MAX_PRICE = parseInt(process.env.MAX_PRICE);
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) * 1000; // Intervalo general de verificación
const ALERT_INTERVAL = parseInt(process.env.ALERT_INTERVAL) * 1000; // Intervalo para enviar notificaciones vistosas

// Variables globales
let accessToken = null;
let tokenExpiration = 0;
let alertTimers = new Map(); // Timers por servidor

// Configurar Express para responder solicitudes
app.get("/", (req, res) => res.send("El bot está activo y funcionando."));

// Crear el servidor HTTP
const server = http.createServer(app);

// Iniciar el servidor HTTP
server.listen(PORT, () => {
    console.log(`Servidor HTTP activo en el puerto ${PORT}`);
});

// Función para obtener el Access Token de Battle.net
async function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiration) return accessToken;

    try {
        const response = await axios.post("https://oauth.battle.net/token", null, {
            auth: { username: process.env.CLIENT_ID, password: process.env.CLIENT_SECRET },
            params: { grant_type: "client_credentials" },
        });
        accessToken = response.data.access_token;
        tokenExpiration = Date.now() + response.data.expires_in * 1000;
        return accessToken;
    } catch (error) {
        console.error("Error obteniendo Access Token:", error);
    }
}

// Función para obtener el precio del WoW Token
async function getWowTokenPrice() {
    const token = await getAccessToken();
    if (!token) return null;

    try {
        const response = await axios.get("https://us.api.blizzard.com/data/wow/token/index", {
            headers: { Authorization: `Bearer ${token}` },
            params: { namespace: "dynamic-us", locale: "en_US" },
        });
        return {
            price: Math.floor(response.data.price / 10000), // Convertir de cobre a oro
            updated: new Date(response.data.last_updated_timestamp).toLocaleString("es-VE", {
                timeZone: "America/Caracas",
                dateStyle: "long",
                timeStyle: "short",
            }),
        };
    } catch (error) {
        console.error("Error obteniendo precio del WoW Token:", error);
        return null;
    }
}

// Escuchar mensajes para el comando "!precio"
client.on("messageCreate", async (message) => {
    if (message.author.bot) return; // Ignorar mensajes de otros bots

    if (message.content.trim() === "!precio") {
        console.log(`Comando recibido en servidor ${message.guild.name}, canal ${message.channel.name}`);
        const data = await getWowTokenPrice();
        if (data) {
            message.channel.send(
                `💰 **Precio Actual del WoW Token (US):** ${data.price} oro\n⏱ **Última Actualización:** ${data.updated}`
            );
        } else {
            message.channel.send("⚠️ No se pudo obtener el precio. Inténtalo más tarde.");
        }
    }
});

// Enviar notificación a todos los servidores
async function notifyAllServers(message, embed = null) {
    client.guilds.cache.forEach((guild) => {
        const channel = guild.channels.cache.find(
            (ch) => ch.name === CHANNEL_NAME && ch.type === 0 // 0 es el tipo para canales de texto en Discord.js v14
        );

        if (channel) {
            const options = { content: message };
            if (embed) options.embeds = [embed];

            channel.send(options).catch((error) => {
                console.error(`Error enviando mensaje al canal ${channel.name} en ${guild.name}:`, error);
            });
        } else {
            console.warn(`Canal ${CHANNEL_NAME} no encontrado en el servidor ${guild.name}`);
        }
    });
}
/*async function notifyAllServers(message, embed = null) {
    client.guilds.cache.forEach((guild) => {
        const channel = guild.channels.cache.find(
            (ch) => ch.name === CHANNEL_NAME && ch.isText()
        );

        if (channel) {
            const options = { content: message };
            if (embed) options.embeds = [embed];

            channel.send(options).catch((error) => {
                console.error(`Error enviando mensaje al canal ${channel.name} en ${guild.name}:`, error);
            });
        } else {
            console.warn(`Canal ${CHANNEL_NAME} no encontrado en el servidor ${guild.name}`);
        }
    });
}*/

// Verificación periódica del precio
async function checkPricePeriodically() {
    setInterval(async () => {
        const data = await getWowTokenPrice();
        if (data) {
            // Notificación automática del precio
            await notifyAllServers(
                `💰 **Precio Actual del WoW Token (US):** ${data.price} oro\n⏱ **Última Actualización:** ${data.updated}`
            );

            // Si el precio está en el rango, enviar notificaciones vistosas a los servidores
            client.guilds.cache.forEach((guild) => {
                const guildId = guild.id;
                if (data.price >= MIN_PRICE && data.price <= MAX_PRICE) {
                    if (!alertTimers.has(guildId)) {
                        const alertTimer = setInterval(() => {
                            const alertEmbed = {
                                title: "¡El precio del WoW Token está dentro del rango!",
                                description: `El precio actual es **${data.price} oro**.`,
                                color: 0xffd700, // Oro
                                timestamp: new Date(),
                                footer: { text: "Battle.net API" },
                            };
                            notifyAllServers(
                                `🎉🎉 **¡ALERTA!** 🎉🎉\n💰 **El precio del WoW Token está en el rango establecido:**\n**Precio:** ${data.price} oro\n⏱ **Última Actualización:** ${data.updated}`,
                                alertEmbed
                            );
                        }, ALERT_INTERVAL);
                        alertTimers.set(guildId, alertTimer);
                    }
                } else if (alertTimers.has(guildId)) {
                    // Detener alertas si el precio sale del rango
                    clearInterval(alertTimers.get(guildId));
                    alertTimers.delete(guildId);
                }
            });
        }
    }, CHECK_INTERVAL);
}

// Cuando el bot está listo
client.once("ready", () => {
    console.log(`Bot conectado como ${client.user.tag}`);
    checkPricePeriodically();
});

// Iniciar el bot
client.login(process.env.DISCORD_TOKEN);
