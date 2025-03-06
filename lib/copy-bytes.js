'use strict'

// dst, src are ArrayBuffers
module.exports = function memcpy(dst, src, dstOffset, srcOffset, length) {
  if(length <= 0)
    return

  let dstU8 = new Uint8Array(dst, dstOffset, length)
  let srcU8 = new Uint8Array(src, srcOffset, length)
  dstU8.set(srcU8)
}
