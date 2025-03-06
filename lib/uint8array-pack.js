'use strict'

const copyBytes = require('./copy-bytes')
const { reliable_printf } = require('./printf')


const RELIABLE_LOG_LEVEL_ERROR = 1

const scratch = new DataView(new ArrayBuffer(8))

// from https://github.com/binaryjs/js-binarypack/blob/master/lib/binarypack.js


function pack_uint8 (arr, index, num) {
  arr[index] = num & 0xFF
}


function pack_uint16(arr, index, num) {
  arr[index] = num & 0xff
  arr[index+1] = num >>> 8
}


function pack_uint32 (arr, index, num) {
  const n = num & 0xffffffff
  arr[index] = ((n & 0x000000ff) >>> 0)
  arr[index+1] = ((n & 0x0000ff00) >>>  8)
  arr[index+2] = ((n & 0x00ff0000) >>> 16)
  arr[index+3] = ((n & 0xff000000) >>> 24)
}


// @param Uint8Array dest
module.exports = function pack(dest) {
  let index = 0

  // @param Uint8Array src
  // @param int count number of bytes to copy from src array
  const packArray = function(src, count=src.byteLength, srcOffset=0) {
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/set
    //dest.set(src, index)

    copyBytes(dest.buffer, src.buffer, index, srcOffset, count)
    index += count
  }

  const packInt16 = function(val) {
    if(index + 2 > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packInt16: out of range')
      return
    }

    dest[index] = val >> 8
    dest[index+1] = val & 0xff

    index = index + 2
  }

  const packFloat32 = function(val) {
    if(index + 4 > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packFloat32: out of range')
      return
    }

    scratch.setFloat32(0, val)
    dest[index] = scratch.getUint8(0)
    dest[index+1] = scratch.getUint8(1)
    dest[index+2] = scratch.getUint8(2)
    dest[index+3] = scratch.getUint8(3)
    index = index + 4
  }

  const packFloat64 = function(val) {
    if(index + 8 > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packFloat64: out of range')
      return
    }

    scratch.setFloat64(0, val)
    dest[index] = scratch.getUint8(0)
    dest[index+1] = scratch.getUint8(1)
    dest[index+2] = scratch.getUint8(2)
    dest[index+3] = scratch.getUint8(3)
    dest[index+4] = scratch.getUint8(4)
    dest[index+5] = scratch.getUint8(5)
    dest[index+6] = scratch.getUint8(6)
    dest[index+7] = scratch.getUint8(7)
    index = index + 8
  }

  const packString = function(val) {
    if(index + 1 + val.byteLength > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packString: out of range')
      return
    }

    packUint8(val.length)

    for (let i=0; i < val.length; i++) {
      packUint8(val.charCodeAt(i))
    }
  }

  const packUint8 = function(val, idx) {
    if (idx !== undefined) {
      pack_uint8(dest, idx, val)
      return
    }

    if(index + 1 > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packUint8: out of range')
      return
    }
    pack_uint8(dest, index, val)
    index++
  }

  const packUint16 = function(val, idx) {
    if (idx !== undefined) {
      pack_uint16(dest, idx, val)
      return
    }

    if(index + 2 > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packUint16: out of range')
      return
    }
    pack_uint16(dest, index, val)
    index = index + 2
  }

  const packUint32 = function(val, idx) {
    if (idx !== undefined) {
      pack_uint32(dest, idx, val)
      return
    }

    if(index + 4 > dest.byteLength) {
      reliable_printf(RELIABLE_LOG_LEVEL_ERROR, 'packUint32: out of range')
      return
    }
    pack_uint32(dest, index, val)
    index = index + 4
  }

  const reset = function() {
    index = 0
  }

  const getIndex = function() {
    return index
  }

  const setIndex = function(i) {
    index = i
  }

  return { packArray, packFloat32, packFloat64, packInt16, packString,
    packUint8, packUint16, packUint32, reset, getIndex, setIndex }
}
