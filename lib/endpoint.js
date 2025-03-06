'use strict'

const copyBytes           = require('./copy-bytes')
const pack                = require('./uint8array-pack')
const { reliable_printf } = require('./printf')
const reliable_assert     = require('./assert')
const sb                  = require('./sequence-buffer')
const uint8_increment     = require('./uint8-increment')
const uint16_increment    = require('./uint16-increment')
const unpack              = require('./uint8array-unpack')


const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_SENT =                  0
const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_RECEIVED =              1
const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_ACKED =                 2
const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_STALE =                 3
const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_INVALID =               4
const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_TOO_LARGE_TO_SEND =     5
const RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_TOO_LARGE_TO_RECEIVE =  6
const RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_SENT =                7
const RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_RECEIVED =            8
const RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_INVALID =             9
const RELIABLE_ENDPOINT_NUM_COUNTERS = 10
const RELIABLE_MAX_PACKET_HEADER_BYTES = 9
const RELIABLE_FRAGMENT_HEADER_BYTES = 5

const RELIABLE_LOG_LEVEL_ERROR = 1
const RELIABLE_LOG_LEVEL_DEBUG = 3

const FLT_MAX = Number.MAX_VALUE


// fills a reliable_config_t object
function reliable_default_config(config={}) {
  reliable_assert(config)

  config.name = 'endpoint'  // max length 256
  config.context = null
  config.index = 0
  config.max_packet_size = 16 * 1024
  config.fragment_above = 1024
  config.max_fragments = 16
  config.fragment_size = 1024
  config.ack_buffer_size = 256
  config.sent_packets_buffer_size = 256
  config.received_packets_buffer_size = 256
  config.rtt_smoothing_factor = 0.0025
  config.fragment_reassembly_buffer_size = 64
  config.packet_loss_smoothing_factor = 0.1
  config.bandwidth_smoothing_factor = 0.1
  config.packet_header_size = 28        // note: UDP over IPv4 = 20 + 8 bytes, UDP over IPv6 = 40 + 8 bytes
  config.transmit_packet_function = null
  config.process_packet_function = null
}


// @param double time
function reliable_endpoint_create(config, time ) {
  reliable_assert( config )
  reliable_assert( config.max_packet_size > 0)
  reliable_assert( config.fragment_above > 0)
  reliable_assert( config.max_fragments > 0)
  reliable_assert( config.max_fragments <= 256)
  reliable_assert( config.fragment_size > 0)
  reliable_assert( config.ack_buffer_size > 0 )
  reliable_assert( config.sent_packets_buffer_size > 0 )
  reliable_assert( config.received_packets_buffer_size > 0 )
  reliable_assert( config.transmit_packet_function)
  reliable_assert( config.process_packet_function)

  const sent_packet_allocator = function() {
    return {
      time: 0,          // double
      acked: 0,         // uint32
      sequence: 0,
      packet_bytes : 31 // uint32
    }
  }

  const received_packet_allocator = function() {
    return {
      acked: false,   // uint32
      sequence: 0,
      time: 0,        // double
      packet_bytes: 0 // uint32
    }
  }

  const fragment_reassembly_allocator = function() {
    return {
      sequence: 0, // uint16
      ack: 0,      // uint16
      ack_bits: 0, // uint32
      num_fragments_received: 0,  // int
      num_fragments_total: 0,     // int
      packet_data: null,   // this is a uint8array initialized at run time
      packet_bytes: 0,            // int
      packet_header_bytes: 0,     // int
      fragment_received: new Uint8Array(256)
    }
  }

  const endpoint = {
    config,
    time,
    rtt: 0.0,
    packet_loss: 0.0,
    sent_bandwidth_kbps: 0.0,
    received_bandwidth_kbps: 0.0,
    acked_bandwidth_kbps: 0.0,
    num_acks: 0,  // int
    acks: new Uint16Array(config.ack_buffer_size),
    sequence: 0,  // uint16
    sent_packets: sb.reliable_sequence_buffer_create(config.sent_packets_buffer_size, sent_packet_allocator),
    received_packets: sb.reliable_sequence_buffer_create(config.received_packets_buffer_size, received_packet_allocator),
    fragment_reassembly: sb.reliable_sequence_buffer_create(config.fragment_reassembly_buffer_size, fragment_reassembly_allocator),
    counters: new Array(RELIABLE_ENDPOINT_NUM_COUNTERS)  // uint64
  }

  reliable_assert( endpoint)

  endpoint.counters.fill(0)

  return endpoint
}


function reliable_endpoint_destroy(endpoint) {
  reliable_assert(endpoint)
  reliable_assert(endpoint.acks)
  reliable_assert(endpoint.sent_packets)
  reliable_assert(endpoint.received_packets)

  // TODO
  /*
  for (let i = 0; i < endpoint.config.fragment_reassembly_buffer_size; ++i) {
    let reassembly_data = sb.reliable_sequence_buffer_at_index(endpoint.fragment_reassembly, i)
    if (reassembly_data && reassembly_data.packet_data) {
      endpoint.free_function(reassembly_data.packet_data)
      reassembly_data->packet_data = null
    }
  }

  endpoint.free_function(endpoint->acks)

  sb.reliable_sequence_buffer_destroy(endpoint.sent_packets)
  sb.reliable_sequence_buffer_destroy(endpoint.received_packets)
  sb.reliable_sequence_buffer_destroy(endpoint.fragment_reassembly)

  endpoint.free_function(endpoint.allocator_context, endpoint)
  */
}


// @param uint8array packet_data
// @param uint16 sequence
// @param uint16 ack
// @param uint32 ack_bits
// @return int written header data bytes
function reliable_write_packet_header(packet_data, sequence, ack, ack_bits) {
  const p = pack(packet_data)

  let prefix_byte = 0 // uint8

  if ( ((ack_bits & 0x000000FF) >>> 0) != 0x000000FF )
    prefix_byte |= (1<<1)

  if ( ((ack_bits & 0x0000FF00) >>> 0) != 0x0000FF00 )
    prefix_byte |= (1<<2)

  if ( ((ack_bits & 0x00FF0000) >>> 0) != 0x00FF0000 )
    prefix_byte |= (1<<3)

  if ( ((ack_bits & 0xFF000000) >>> 0) != 0xFF000000 )
    prefix_byte |= (1<<4)

  let sequence_difference = sequence - ack // int

  if (sequence_difference < 0)
    sequence_difference += 65536

  if (sequence_difference <= 255)
    prefix_byte |= (1<<5)

  p.packUint8(prefix_byte)
  p.packUint16(sequence)

  if ( sequence_difference <= 255)
    p.packUint8(sequence_difference)
  else
    p.packUint16(ack)

  if ( ((ack_bits & 0x000000FF) >>> 0) != 0x000000FF ) {
    p.packUint8(ack_bits & 0x000000FF)
  }

  if ( ((ack_bits & 0x0000FF00) >>> 0) != 0x0000FF00 ) {
    p.packUint8((ack_bits & 0x0000FF00) >> 8)
  }

  if ( ((ack_bits & 0x00FF0000) >>> 0) != 0x00FF0000 ) {
    p.packUint8(( ack_bits & 0x00FF0000 ) >> 16 )
  }

  if ( ((ack_bits & 0xFF000000) >>> 0) != 0xFF000000 ) {
    p.packUint8(( ack_bits & 0xFF000000 ) >> 24 )
  }

  const byteCount = p.getIndex()

  reliable_assert(byteCount <= RELIABLE_MAX_PACKET_HEADER_BYTES)
  return byteCount
}


// @param Uint8Array packet_data
// @param int packet_bytes
function reliable_endpoint_send_packet(endpoint, packet_data, packet_bytes) {
  reliable_assert( endpoint )
  reliable_assert( packet_data )
  reliable_assert( packet_bytes > 0 )

  if (packet_bytes > endpoint.config.max_packet_size) {
    reliable_printf(RELIABLE_LOG_LEVEL_ERROR, "[%s] packet too large to send. packet is %d bytes, maximum is %d",
            endpoint.config.name, packet_bytes, endpoint.config.max_packet_size)

    endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_TOO_LARGE_TO_SEND]++
    return
  }

  let sequence = endpoint.sequence
  endpoint.sequence = uint16_increment(endpoint.sequence)


  const ack_struct = { ack: 0, ack_bits: 0 }
  sb.reliable_sequence_buffer_generate_ack_bits(endpoint.received_packets, ack_struct)

  let sent_packet_data = sb.reliable_sequence_buffer_insert(endpoint.sent_packets, sequence)
  reliable_assert( sent_packet_data )

  sent_packet_data.time = endpoint.time
  sent_packet_data.packet_bytes = endpoint.config.packet_header_size + packet_bytes
  sent_packet_data.acked = 0

  if ( packet_bytes <= endpoint.config.fragment_above ) {
    // regular packet

    reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] sending packet %d without fragmentation", endpoint.config.name, sequence )

    const transmit_packet_data = new Uint8Array(packet_bytes + RELIABLE_MAX_PACKET_HEADER_BYTES)

    const packet_header_bytes = reliable_write_packet_header(transmit_packet_data, sequence, ack_struct.ack, ack_struct.ack_bits)

    // API: copyBytes(dest, src, destOffset, srcOffset, count)
    copyBytes(transmit_packet_data.buffer, packet_data.buffer, packet_header_bytes, 0, packet_bytes)
    //memcpy( transmit_packet_data + packet_header_bytes, packet_data, packet_bytes )

    endpoint.config.transmit_packet_function(endpoint.config.context, endpoint.config.index, sequence, transmit_packet_data, packet_header_bytes + packet_bytes)

  } else {

    // fragmented packet
    const packet_header = new Uint8Array(RELIABLE_MAX_PACKET_HEADER_BYTES)
    packet_header.fill(0)

    const packet_header_bytes = reliable_write_packet_header(packet_header, sequence, ack_struct.ack, ack_struct.ack_bits)
    const num_fragments = Math.ceil(packet_bytes / endpoint.config.fragment_size)

    reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] sending packet %d as %d fragments", endpoint.config.name, sequence, num_fragments )

    reliable_assert(num_fragments >= 1)
    reliable_assert(num_fragments <= endpoint.config.max_fragments)

    const fragment_buffer_size = RELIABLE_FRAGMENT_HEADER_BYTES + RELIABLE_MAX_PACKET_HEADER_BYTES + endpoint.config.fragment_size

    const fragment_packet_data = new Uint8Array(fragment_buffer_size)

    let q = pack(packet_data)
    let end = pack(packet_data)
    end.setIndex(packet_bytes)

    for(let fragment_id=0; fragment_id < num_fragments; ++fragment_id) {
      let p = pack(fragment_packet_data)

      p.packUint8(1)
      p.packUint16(sequence)
      p.packUint8(fragment_id)
      p.packUint8(num_fragments - 1)

      if(fragment_id === 0)
        p.packArray(packet_header, packet_header_bytes)

      let bytes_to_copy = endpoint.config.fragment_size
      if(q.getIndex() + bytes_to_copy > end.getIndex())
        bytes_to_copy = end.getIndex() - q.getIndex() // int

      // API: memcpy(dest, src, count)
      //memcpy( p, q, bytes_to_copy )
      p.packArray(packet_data, bytes_to_copy, q.getIndex())

      q.setIndex(q.getIndex() + bytes_to_copy)

      let fragment_packet_bytes = p.getIndex()
      //int fragment_packet_bytes = (int) ( p - fragment_packet_data )

      endpoint.config.transmit_packet_function(endpoint.config.context, endpoint.config.index, sequence, fragment_packet_data, fragment_packet_bytes)

      endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_SENT]++
    }
  }

  endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_SENT]++
}


// @param string name
// @param uint8array packet_data
// @param int packet_bytes
// @param object read_struct
// @param uint16* read_struct.sequence
// @param uint16* read_struct.ack
// @param uint32* read_struct.ack_bits
// @return int bytes read from packet header. -1 on error
function reliable_read_packet_header(name, packet_data, packet_bytes, read_struct) {
  if (packet_bytes < 3) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] packet too small for packet header (1)", name )
    return -1
  }

  const p = unpack(packet_data)

  const prefix_byte = p.unpackUint8()

  if ( ( prefix_byte & 1 ) != 0 ) {
     reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] prefix byte does not indicate a regular packet", name )
    return -1
  }

  read_struct.sequence = p.unpackUint16()


  if ( prefix_byte & (1<<5) ) {
    if ( packet_bytes < 3 + 1 ) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] packet too small for packet header (2)", name )
      return -1
    }

    let sequence_difference = p.unpackUint8()
    read_struct.ack = uint16_increment(read_struct.sequence, -sequence_difference)

  } else {
    if ( packet_bytes < 3 + 2 ) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] packet too small for packet header (3)", name )
      return -1
    }
    read_struct.ack = p.unpackUint16()
  }


  let expected_bytes = 0 // int
  for (let i = 1; i <= 4; ++i )
    if (prefix_byte & (1<<i))
      expected_bytes++

  //if ( packet_bytes < ( p - packet_data ) + expected_bytes ) {
  if (packet_bytes < p.getIndex() + expected_bytes) {
    reliable_printf(RELIABLE_LOG_LEVEL_ERROR, "[%s] packet too small for packet header (4)", name)
    return -1
  }

  let ack_bits = 0xFFFFFFFF

  if ( prefix_byte & (1<<1) ) {
    ack_bits &= 0xFFFFFF00
    ack_bits |= p.unpackUint8()
  }

  if ( prefix_byte & (1<<2) ) {
    ack_bits &= 0xFFFF00FF
    ack_bits |= (p.unpackUint8() << 8)
  }

  if ( prefix_byte & (1<<3) ) {
    ack_bits &= 0xFF00FFFF
    ack_bits |= (p.unpackUint8() << 16)
  }

  if ( prefix_byte & (1<<4) ) {
    ack_bits &= 0x00FFFFFF
    ack_bits |= (p.unpackUint8() << 24)
  }

  // always end bit wise ops with ">>> 0" so the result is interpreted as unsigned.
  ack_bits = ack_bits >>> 0
  read_struct.ack_bits = ack_bits

  return p.getIndex()
}


// @param string name
// @param uint8array packet_data
// @param int packet_bytes
// @param int max_fragments
// @param int fragment_size
// @param object frag_struct reference to several modifiable variables
// @param int* frag_struct.fragment_id
// @param int* frag_struct.num_fragments
// @param int* frag_struct.fragment_bytes
// @param uint16* frag_struct.sequence
// @param uint16* frag_struct.ack
// @param uint32* frag_struct.ack_bits
// @return int number of bytes read from fragment header
function reliable_read_fragment_header(name, packet_data, packet_bytes, max_fragments, fragment_size, frag_struct) {

  reliable_assert(frag_struct)

  if (packet_bytes < RELIABLE_FRAGMENT_HEADER_BYTES) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] packet is too small to read fragment header", name )
    return -1
  }

  let p = unpack(packet_data)

  const prefix_byte = p.unpackUint8()

  if ( prefix_byte != 1) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] prefix byte is not a fragment", name );
    return -1
  }

  frag_struct.sequence = p.unpackUint16()

  frag_struct.fragment_id = p.unpackUint8()
  frag_struct.num_fragments = p.unpackUint8() + 1


  if (frag_struct.num_fragments > max_fragments ) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] num fragments %d outside of range of max fragments %d", name, frag_struct.num_fragments, max_fragments )
    return -1
  }

  if (frag_struct.fragment_id >= frag_struct.num_fragments ) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] fragment id %d outside of range of num fragments %d", name, frag_struct.fragment_id, frag_struct.num_fragments )
    return -1
  }


  frag_struct.fragment_bytes = packet_bytes - RELIABLE_FRAGMENT_HEADER_BYTES

  const packet_read_struct = { sequence: 0, ack: 0, ack_bits: 0 }

  if(frag_struct.fragment_id === 0) {

    const scratch = new Uint8Array(packet_bytes - RELIABLE_FRAGMENT_HEADER_BYTES)
    // API: copyBytes(dest, src, destOffset, srcOffset, count)
    copyBytes(scratch.buffer, packet_data.buffer, 0, RELIABLE_FRAGMENT_HEADER_BYTES, packet_bytes - RELIABLE_FRAGMENT_HEADER_BYTES)

    let packet_header_bytes = reliable_read_packet_header(name,
                                                         scratch,
                                                         packet_bytes,
                                                         packet_read_struct)

    if ( packet_header_bytes < 0 ) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] bad packet header in fragment", name )
      return -1
    }

    if (packet_read_struct.sequence != frag_struct.sequence) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] bad packet sequence in fragment. expected %d, got %d", name, frag_struct.sequence, packet_read_struct.packet_sequence )
      return -1
    }

    frag_struct.fragment_bytes = packet_bytes - packet_header_bytes - RELIABLE_FRAGMENT_HEADER_BYTES
  }

  frag_struct.ack = packet_read_struct.ack
  frag_struct.ack_bits = packet_read_struct.ack_bits


  if (frag_struct.fragment_bytes > fragment_size) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] fragment bytes %d > fragment size %d", name, frag_struct.fragment_bytes, fragment_size );
    return - 1
  }

  if ( (frag_struct.fragment_id != frag_struct.num_fragments - 1) && frag_struct.fragment_bytes != fragment_size ) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] fragment %d is %d bytes, which is not the expected fragment size %d",
            name, frag_struct.fragment_id, frag_struct.fragment_bytes, fragment_size )
    return -1
  }

  return p.getIndex()
}


// @param Object fragment_reassembly_data reassembly_data
// @param uint16 sequence
// @param uint16 ack
// @param uint32 ack_bits
// @param int fragment_id
// @param int fragment_size
// @param uint8array fragment_data
// @param int fragment_bytes
function reliable_store_fragment_data(reassembly_data, sequence, ack, ack_bits, fragment_id, fragment_size, fragment_data, fragment_bytes) {

  let index = 0

  if (fragment_id === 0) {
    let packet_header = new Uint8Array(RELIABLE_MAX_PACKET_HEADER_BYTES)
    packet_header.fill(0)

    reassembly_data.packet_header_bytes = reliable_write_packet_header(packet_header, sequence, ack, ack_bits)

    // API: copyBytes(dest, src, destOffset, srcOffset, count)
    copyBytes(reassembly_data.packet_data.buffer,
              packet_header.buffer,
              RELIABLE_MAX_PACKET_HEADER_BYTES - reassembly_data.packet_header_bytes,
              0,
              reassembly_data.packet_header_bytes)


    // API: memcpy(dest, src, count)
    //memcpy( reassembly_data.packet_data + RELIABLE_MAX_PACKET_HEADER_BYTES - reassembly_data.packet_header_bytes,
    //        packet_header,
    //        reassembly_data.packet_header_bytes )

    index += reassembly_data.packet_header_bytes
    //fragment_data += reassembly_data.packet_header_bytes
    fragment_bytes -= reassembly_data.packet_header_bytes
  }

  if (fragment_id === reassembly_data.num_fragments_total - 1)
    reassembly_data.packet_bytes = (reassembly_data.num_fragments_total - 1) * fragment_size + fragment_bytes

  // API: copyBytes(dest, src, destOffset, srcOffset, count)
  copyBytes(reassembly_data.packet_data.buffer, fragment_data.buffer, RELIABLE_MAX_PACKET_HEADER_BYTES + fragment_id * fragment_size, index, fragment_bytes)
  //memcpy( reassembly_data.packet_data + RELIABLE_MAX_PACKET_HEADER_BYTES + fragment_id * fragment_size, fragment_data, fragment_bytes )
}


// @param object endpoint
// @param uint8array packet_data
// @param int packet_bytes
function reliable_endpoint_receive_packet(endpoint, packet_data, packet_bytes) {

  reliable_assert( endpoint )
  reliable_assert( packet_data )
  reliable_assert( packet_bytes > 0 )

  if (packet_bytes > endpoint.config.max_packet_size) {
    reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] packet too large to receive. packet is %d bytes, maximum is %d",
            endpoint.config.name, packet_bytes, endpoint.config.max_packet_size)
    endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_TOO_LARGE_TO_RECEIVE]++
    return
  }

  const prefix_byte = packet_data[0]

  if((prefix_byte & 1) === 0) {
    // regular packet

    endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_RECEIVED]++

    const read_struct = { sequence: 0, ack: 0, ack_bits: 0 }  // uint16, uint16, uint32
    const packet_header_bytes = reliable_read_packet_header(endpoint.config.name, packet_data, packet_bytes, read_struct)

    if (packet_header_bytes < 0) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] ignoring invalid packet. could not read packet header", endpoint.config.name );
      endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_INVALID]++
      return
    }

    if (!sb.reliable_sequence_buffer_test_insert(endpoint.received_packets, read_struct.sequence)) {
      reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] ignoring stale packet %d", endpoint.config.name, read_struct.sequence )
      endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_STALE]++
      return
    }

    const len2 = packet_bytes - packet_header_bytes
    const scratch2 = new Uint8Array(len2)
    copyBytes(scratch2.buffer, packet_data.buffer, 0, packet_header_bytes, len2)

    reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] processing packet %d", endpoint.config.name, read_struct.sequence )

    if (endpoint.config.process_packet_function( endpoint.config.context,
                                                 endpoint.config.index,
                                                 read_struct.sequence,
                                                 scratch2, //packet_data,
                                                 packet_bytes - packet_header_bytes) )
    {
      reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] process packet %d successful", endpoint.config.name, read_struct.sequence )
      let received_packet_data = sb.reliable_sequence_buffer_insert(endpoint.received_packets, read_struct.sequence)

      reliable_assert(received_packet_data)

      received_packet_data.time = endpoint.time
      received_packet_data.packet_bytes = endpoint.config.packet_header_size + packet_bytes

      for (let i = 0; i < 32; ++i ) {
        if ( read_struct.ack_bits & 1 ) {
          let ack_sequence = uint16_increment(read_struct.ack, -i)

          let sent_packet_data = sb.reliable_sequence_buffer_find(endpoint.sent_packets, ack_sequence)

          if (sent_packet_data && !sent_packet_data.acked && endpoint.num_acks < endpoint.config.ack_buffer_size) {
            reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] acked packet %d", endpoint.config.name, ack_sequence )
            endpoint.acks[endpoint.num_acks++] = ack_sequence
            endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_PACKETS_ACKED]++
            sent_packet_data.acked = 1

            let rtt = (endpoint.time - sent_packet_data.time) * 1000.0
            reliable_assert(rtt >= 0.0)
            if ( ( endpoint.rtt == 0.0 && rtt > 0.0 ) || Math.abs( endpoint.rtt - rtt ) < 0.00001 )
              endpoint.rtt = rtt
            else
              endpoint.rtt += ( rtt - endpoint.rtt ) * endpoint.config.rtt_smoothing_factor
          }
        }
        read_struct.ack_bits >>= 1
      }

    } else {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] process packet failed", endpoint.config.name )
    }

  } else {
    // fragment packet

    const frag_struct = {
      fragment_id: 0,
      num_fragments: 0,
      fragment_bytes: 0,
      sequence: 0,
      ack: 0,
      ack_bits: 0
    }
    const fragment_header_bytes = reliable_read_fragment_header(endpoint.config.name,
                                                              packet_data,
                                                              packet_bytes,
                                                              endpoint.config.max_fragments,
                                                              endpoint.config.fragment_size,
                                                              frag_struct)

    if(fragment_header_bytes < 0) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] ignoring invalid fragment. could not read fragment header", endpoint.config.name )
      endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_INVALID]++
      return
    }

    let reassembly_data = sb.reliable_sequence_buffer_find(endpoint.fragment_reassembly, frag_struct.sequence)

    if(!reassembly_data) {
      reassembly_data = sb.reliable_sequence_buffer_insert(endpoint.fragment_reassembly, frag_struct.sequence)

      if(!reassembly_data) {
        reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] ignoring invalid fragment. could not insert in reassembly buffer (stale)", endpoint.config.name )
        endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_INVALID]++
        return
      }

      let packet_buffer_size = RELIABLE_MAX_PACKET_HEADER_BYTES + frag_struct.num_fragments * endpoint.config.fragment_size

      reassembly_data.sequence = frag_struct.sequence
      reassembly_data.ack = 0
      reassembly_data.ack_bits = 0
      reassembly_data.num_fragments_received = 0
      reassembly_data.num_fragments_total = frag_struct.num_fragments
      reassembly_data.packet_data = new Uint8Array(packet_buffer_size)
      reassembly_data.packet_bytes = 0
      reassembly_data.fragment_received.fill(0)
    }

    if (frag_struct.num_fragments != reassembly_data.num_fragments_total ) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] ignoring invalid fragment. fragment count mismatch. expected %d, got %d",
                endpoint.config.name, reassembly_data.num_fragments_total, frag_struct.num_fragments )
      endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_INVALID]++
      return
    }

    if ( reassembly_data.fragment_received[frag_struct.fragment_id] ) {
      reliable_printf( RELIABLE_LOG_LEVEL_ERROR, "[%s] ignoring fragment %d of packet %d. fragment already received",
                endpoint.config.name, frag_struct.fragment_id, frag_struct.sequence )
      return
    }

    reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] received fragment %d of packet %d (%d/%d)",
            endpoint.config.name, frag_struct.fragment_id, frag_struct.sequence, reassembly_data.num_fragments_received+1, frag_struct.num_fragments );

    reassembly_data.num_fragments_received++
    reassembly_data.fragment_received[frag_struct.fragment_id] = 1

    let scratch = new Uint8Array(packet_bytes - fragment_header_bytes)

    copyBytes(scratch.buffer, packet_data.buffer, 0, fragment_header_bytes, packet_bytes - fragment_header_bytes)

    reliable_store_fragment_data( reassembly_data,
                                  frag_struct.sequence,
                                  frag_struct.ack,
                                  frag_struct.ack_bits,
                                  frag_struct.fragment_id,
                                  endpoint.config.fragment_size,
                                  scratch, //packet_data + fragment_header_bytes,
                                  packet_bytes - fragment_header_bytes )

    if ( reassembly_data.num_fragments_received === reassembly_data.num_fragments_total ) {
      reliable_printf( RELIABLE_LOG_LEVEL_DEBUG, "[%s] completed reassembly of packet %d", endpoint.config.name, frag_struct.sequence )

      const dataLength = reassembly_data.packet_header_bytes + reassembly_data.packet_bytes

      scratch = new Uint8Array(dataLength)
      copyBytes(scratch.buffer, reassembly_data.packet_data.buffer, 0, RELIABLE_MAX_PACKET_HEADER_BYTES - reassembly_data.packet_header_bytes, dataLength)

      reliable_endpoint_receive_packet( endpoint,
                                        scratch, //reassembly_data.packet_data + RELIABLE_MAX_PACKET_HEADER_BYTES - reassembly_data.packet_header_bytes,
                                        reassembly_data.packet_header_bytes + reassembly_data.packet_bytes)

      sb.reliable_sequence_buffer_remove( endpoint.fragment_reassembly, frag_struct.sequence)
    }

    endpoint.counters[RELIABLE_ENDPOINT_COUNTER_NUM_FRAGMENTS_RECEIVED]++
  }
}


function reliable_endpoint_reset(endpoint) {
  reliable_assert(endpoint)

  endpoint.num_acks = 0
  endpoint.sequence = 0
  endpoint.acks.fill(0)

  /*
  for (let i = 0; i < endpoint.config.fragment_reassembly_buffer_size; ++i) {
    let reassembly_data = sb.reliable_sequence_buffer_at_index(endpoint.fragment_reassembly, i)

    if (reassembly_data && reassembly_data.packet_data ) {
      endpoint.free_function(reassembly_data.packet_data )
      reassembly_data.packet_data = null
    }
  }
  */

  sb.reliable_sequence_buffer_reset(endpoint.sent_packets)
  sb.reliable_sequence_buffer_reset(endpoint.received_packets)
  sb.reliable_sequence_buffer_reset(endpoint.fragment_reassembly)
}


// @param object endpoint
// @param float time
function reliable_endpoint_update(endpoint, time) {
  reliable_assert(endpoint)

  endpoint.time = time

  // calculate packet loss
  {
    let base_sequence = ( endpoint.sent_packets.sequence - endpoint.config.sent_packets_buffer_size + 1 ) + 0xFFFF
    let num_dropped = 0
    let num_samples = Math.floor(endpoint.config.sent_packets_buffer_size / 2)
    for (let i = 0; i < num_samples; ++i) {
      let sequence = uint16_increment(base_sequence, i)
      let sent_packet_data = sb.reliable_sequence_buffer_find(endpoint.sent_packets, sequence)
      if (sent_packet_data && sent_packet_data.acked)
        num_dropped++
    }
    let packet_loss = (num_dropped / num_samples) * 100.0
    if ( Math.abs( endpoint.packet_loss - packet_loss) > 0.00001)
      endpoint.packet_loss += ( packet_loss - endpoint.packet_loss ) * endpoint.config.packet_loss_smoothing_factor
    else
      endpoint.packet_loss = packet_loss
  }

  // calculate sent bandwidth
  {
    let base_sequence = ( endpoint.sent_packets.sequence - endpoint.config.sent_packets_buffer_size + 1) + 0xFFFF
    let bytes_sent = 0
    let start_time = FLT_MAX
    let finish_time = 0.0
    let num_samples = Math.floor(endpoint.config.sent_packets_buffer_size / 2)
    for (let i = 0; i < num_samples; ++i ) {
      let sequence = uint16_increment(base_sequence, i)
      let sent_packet_data = sb.reliable_sequence_buffer_find(endpoint.sent_packets, sequence)
      if ( !sent_packet_data )
        continue

      bytes_sent += sent_packet_data.packet_bytes
      if ( sent_packet_data.time < start_time )
        start_time = sent_packet_data.time

      if ( sent_packet_data.time > finish_time )
        finish_time = sent_packet_data.time
    }
    if (start_time != FLT_MAX && finish_time != 0.0) {
      let sent_bandwidth_kbps = bytes_sent / (finish_time - start_time) * 8.0 / 1000.0
      if (Math.abs( endpoint.sent_bandwidth_kbps - sent_bandwidth_kbps) > 0.00001)
        endpoint.sent_bandwidth_kbps += ( sent_bandwidth_kbps - endpoint.sent_bandwidth_kbps ) * endpoint.config.bandwidth_smoothing_factor
      else
        endpoint.sent_bandwidth_kbps = sent_bandwidth_kbps
    }
  }


  // calculate received bandwidth
  {
    let base_sequence = ( endpoint.received_packets.sequence - endpoint.config.received_packets_buffer_size + 1 ) + 0xFFFF

    let bytes_sent = 0
    let start_time = FLT_MAX
    let finish_time = 0.0
    let num_samples = Math.floor(endpoint.config.received_packets_buffer_size / 2)
    for (let i = 0; i < num_samples; ++i ) {
      let sequence = uint16_increment(base_sequence, i )
      let received_packet_data = sb.reliable_sequence_buffer_find(endpoint.received_packets, sequence)
      if (!received_packet_data)
        continue
      bytes_sent += received_packet_data.packet_bytes
      if (received_packet_data.time < start_time)
        start_time = received_packet_data.time

      if (received_packet_data.time > finish_time)
        finish_time = received_packet_data.time
    }
    if (start_time != FLT_MAX && finish_time != 0.0) {
      let received_bandwidth_kbps = bytes_sent / (finish_time - start_time) * 8.0 / 1000.0
      if ( Math.abs(endpoint.received_bandwidth_kbps - received_bandwidth_kbps) > 0.00001)
        endpoint.received_bandwidth_kbps += ( received_bandwidth_kbps - endpoint.received_bandwidth_kbps ) * endpoint.config.bandwidth_smoothing_factor
      else
        endpoint.received_bandwidth_kbps = received_bandwidth_kbps
    }
  }


  // calculate acked bandwidth
  {
    let base_sequence = ( endpoint.sent_packets.sequence - endpoint.config.sent_packets_buffer_size + 1 ) + 0xFFFF
    let bytes_sent = 0
    let start_time = FLT_MAX
    let finish_time = 0.0
    let num_samples = Math.floor(endpoint.config.sent_packets_buffer_size / 2)
    for (let i = 0; i < num_samples; ++i ) {
      let sequence = uint16_increment(base_sequence + i)
      let sent_packet_data = sb.reliable_sequence_buffer_find(endpoint.sent_packets, sequence)

      if (!sent_packet_data || !sent_packet_data.acked)
        continue

      bytes_sent += sent_packet_data.packet_bytes
      if (sent_packet_data.time < start_time)
        start_time = sent_packet_data.time

      if (sent_packet_data.time > finish_time)
        finish_time = sent_packet_data.time
    }
    if ( start_time != FLT_MAX && finish_time != 0.0 ) {
      let acked_bandwidth_kbps = bytes_sent / (finish_time - start_time) * 8.0 / 1000.0
      if ( Math.abs( endpoint.acked_bandwidth_kbps - acked_bandwidth_kbps ) > 0.00001)
        endpoint.acked_bandwidth_kbps += ( acked_bandwidth_kbps - endpoint.acked_bandwidth_kbps ) * endpoint.config.bandwidth_smoothing_factor;
      else
        endpoint.acked_bandwidth_kbps = acked_bandwidth_kbps
    }
  }

}


module.exports = {
  reliable_default_config,
  reliable_endpoint_destroy,
  reliable_endpoint_create,
  reliable_write_packet_header,
  reliable_endpoint_send_packet,
  reliable_read_packet_header,
  reliable_endpoint_receive_packet,
  reliable_endpoint_reset,
  reliable_endpoint_update
}
