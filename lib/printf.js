'use strict'

const debug = require('debug')('reliable.io')


const RELIABLE_ENABLE_LOGGING  = true
const RELIABLE_LOG_LEVEL_NONE  = 0
const RELIABLE_LOG_LEVEL_ERROR = 1
const RELIABLE_LOG_LEVEL_INFO  = 2
const RELIABLE_LOG_LEVEL_DEBUG = 3


let log_level = 0


function reliable_log_level(level) {
  log_level = level
}

let reliable_printf

if(RELIABLE_ENABLE_LOGGING) {
  reliable_printf = function(level, format, ...args) {
    if (level <= log_level)
      debug(format, ...args)
  }
} else {
  reliable_printf = function() { }
}


module.exports = { reliable_printf, reliable_log_level }
