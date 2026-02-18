import Paho from './node_modules/paho-client/src/mqttws31.js'
import debug from 'debug'
import wildcard from './lib/wildcard-matcher.js'

// enable with localStorage.debug = '*'
const mtq_debug = debug('MQT')
const paho_debug = debug('MQT:PAHO')

export default function MQT(_host) {

  const _subs = []
  const _outbox = []

  const ssl = !!_host.match(/^wss:\/\//);

  const host_parts = _host.replace(/wss?:\/\//,'').split(':')

  var host = host_parts[0] || 'localhost'
  var port = parseInt(host_parts[1]) || (ssl?443:80)
  var clientID = 'mqt_' + Math.random().toString(32).substr(2,5)

  mtq_debug(`Connecting to host=${host} port=${port} ssl?=${ssl}`)

  const client = new Paho.MQTT.Client(host, port, clientID)

  // set callback handlers
  client.onConnectionLost = onConnectionLost
  client.onMessageArrived = onMessageArrived

  // connect the client
  function connect() {
    return new Promise((accept, reject) => {
      client.connect({
        onSuccess: accept,
        timeout: 3,
        onFailure: reject,
        useSSL: ssl,
        mqttVersion: 4
      })
    })
  }

  const ready = connect()

  ready
    .then(onConnect)
    .catch(message => {
      paho_debug("FAILED", message)
      console.error("FAILED TO CONNECT", message)
    })

  const send = this._send = (topic, message) => {
    message = new Paho.MQTT.Message(message)
    message.destinationName = topic
    client.send(message)
  }


  // called when the client connects
  // do subscriptions etc
  function onConnect() {
    paho_debug("Connected")

    // initial connections
    _subs.forEach(([topic, callback]) => {
      paho_debug(`subscribing to ${topic}`)
      client.subscribe(topic)
    })

    // send off outbox messages
    while(_outbox.length) {
      const content = _outbox.pop()
      const message = new Paho.MQTT.Message(
        JSON.stringify(content[1])
      )
      message.destinationName = content[0]
      client.send(message)
    }

  }

  // called when the client loses its connection
  function onConnectionLost(responseObject) {
    paho_debug(`Connection lost ${responseObject.errorMessage}`)
    if (responseObject.errorCode !== 0) {
      paho_debug(`Reconnecting`)
      setTimeout(connect, 1000)
    }
  }

  // called when a message arrives
  function onMessageArrived(message) {
    paho_debug(`Message Arrived`)

    mtq_debug(`Message topic: ${message.destinationName}`)

    const target = message.destinationName.split('/')
    const payload = maybe_from_json(message.payloadString)

    _subs.forEach(([topic, callback, matcher]) => {
      if(matcher(target)) {
        mtq_debug(`Matched with topic ${topic}`)
        callback(payload)
      }
    })
  }

  function maybe_from_json(whatever) {
    try {
      return JSON.parse(whatever)
    } catch (e) {
      return whatever
    }
  }

  return {
    ready: ready,
    subscribe: (topic, callback) => {
      _subs.push([topic, callback, wildcard(topic)])
      if(client.isConnected()) {
        client.subscribe(topic)
      }
    },
    publish: (topic, payload) => {
      if(client.isConnected()) {
        const message = new Paho.MQTT.Message(
          JSON.stringify(payload)
        )
        message.destinationName = topic
        client.send(message)
      } else {
        _outbox.push([topic, payload])
      }
    }
  }
}
