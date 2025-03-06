'use strict'

const UINT8_WRAP = new Uint8Array(1)


// a javascript number is 64 bits. when dealing with uint8 values, manually force wrap around
//
// @param number n    number to increment, treating as uint8
// @param number incr amount to increment
module.exports = function uint8_increment(n, incr=1) {
  UINT8_WRAP[0] = n + incr
  return UINT8_WRAP[0]
}
