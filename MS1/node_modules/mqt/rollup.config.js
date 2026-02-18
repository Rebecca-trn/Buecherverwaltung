import commonjs from 'rollup-plugin-commonjs'
import replace from 'rollup-plugin-re'
import buble from 'rollup-plugin-buble'
import nodeResolve from 'rollup-plugin-node-resolve'

export default {
  entry: 'index.js',
  dest: 'build/mqt.js',
  plugins: [
    nodeResolve({
      browser: true
    }),
    commonjs(),

    // fix a couple of problems with "use strict" and Paho
    replace({
      patterns: [
        {
          test: 'Paho = {}',
          replace: 'var Paho = {}',
        },
        {
          test: '		wireMessage = new',
          replace: '		var wireMessage = new'
        }
      ]
    }),
    buble({
      exclude: [ 'node_modules/**' ]
    })
  ],
  moduleName: 'MQT',
  format: 'umd'
}
