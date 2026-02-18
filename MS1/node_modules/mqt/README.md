# MQT

**This is a hack, you might not want to use it yet**

MQT is like mqtt, but with less stuff going on

```js
const mqt = new MQT('test.mosquitto.org:8080')

mqt.subscribe('/foo/+/baz', m => {
  console.log(`hello ${m}`)
})

mqt.publish('/foo/bar/baz', 'world')
```

This is an opinionated wrapper around the [Paho JavaScript client](http://www.eclipse.org/paho/clients/js/) providing a simpler api.

This allows the browser to interact with IoT networks.

## Plans / todo

* connection/auth/client_id options
* Better binary data options
* wss support
* offline/message queuing
