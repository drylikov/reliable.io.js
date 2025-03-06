'use strict'

const UINT16_WRAP = new Uint16Array(1)


// a javascript number is 64 bits. when dealing with uint16 values, manually force wrap around
//
// @param number n    number to increment, treating as uint16
// @param number incr amount to increment
module.exports = function uint16_increment(n, incr=1) {
  UINT16_WRAP[0] = n + incr
  return UINT16_WRAP[0]
}
