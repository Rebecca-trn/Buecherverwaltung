const mqtt = require("mqtt");
const client = mqtt.connect("mqtt://mqtt-broker:1883");

module.exports = client;