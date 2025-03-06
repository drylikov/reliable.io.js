'use strict'

const endpoint = require('./lib/endpoint')


const MAX_PACKET_BYTES = (16*1024)


function assert(param) {
  if(!param)
    throw new Error('assertion failed')
}


function random_int(a, b) {
  assert( a < b )
  let result = Math.round(Math.random() * (b-a)) + a
  //int result = a + rand() % ( b - a + 1 )
  assert( result >= a )
  assert( result <= b )
  return result
}


function test_transmit_packet_function( context, index, sequence, packet_data, packet_bytes ) { }


function test_process_packet_function( context, index, sequence, packet_data, packet_bytes ) {
  return 1
}

function fuzz_initialize() {
  const config = {}
  endpoint.reliable_default_config(config)

  config.index = 0
  config.transmit_packet_function = test_transmit_packet_function
  config.process_packet_function = test_process_packet_function

  e = endpoint.reliable_endpoint_create( config, global_time )
}


function fuzz_iteration() {
  let packet_data = new Uint8Array(MAX_PACKET_BYTES)

  let packet_bytes = random_int(1, MAX_PACKET_BYTES)

  for (let i = 0; i < packet_bytes; ++i )
    packet_data[i] = random_int(0, 255)

  endpoint.reliable_endpoint_receive_packet(e, packet_data, packet_bytes)
  endpoint.reliable_endpoint_update(e, global_time)
  endpoint.num_acks = 0

  global_time += delta_time

  process.nextTick(fuzz_iteration)
}


function main() {
  console.log( "[fuzz]\n" )
  fuzz_initialize()
  fuzz_iteration()
}


let e, global_time = 100.0, delta_time = 0.1

main()
