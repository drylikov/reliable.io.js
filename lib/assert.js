'use strict'

const debug = require('debug')('reliable.io')


module.exports = function assert(param) {
  if(debug.enabled && !param)
    throw new Error('assertion failed')
}
