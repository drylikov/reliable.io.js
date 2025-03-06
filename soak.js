'use strict'

const endpoint = require('./lib/endpoint')
const { reliable_log_level } = require('./lib/printf')


const MAX_PACKET_BYTES = (16*1024)
const RELIABLE_LOG_LEVEL_DEBUG = 3

reliable_log_level(RELIABLE_LOG_LEVEL_DEBUG)


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


function test_transmit_packet_function( context, index, sequence, packet_data, packet_bytes) {

  if ( random_int(0,100) < 5 )
    return

  if ( index == 0 )
    endpoint.reliable_endpoint_receive_packet( context.server, packet_data, packet_bytes )
  else if ( index == 1 )
    endpoint.reliable_endpoint_receive_packet( context.client, packet_data, packet_bytes )
}


function generate_packet_data(sequence, packet_data) {
  let packet_bytes = ( ( sequence * 1023 ) % ( MAX_PACKET_BYTES - 2 ) ) + 2
  assert( packet_bytes >= 2 )
  assert( packet_bytes <= MAX_PACKET_BYTES )
  packet_data[0] = sequence & 0xFF
  packet_data[1] = ( (sequence>>8) & 0xFF )

  for (let i = 2; i < packet_bytes; ++i)
    packet_data[i] = ( (i + sequence) % 256 )
  return packet_bytes
}


function check_packet_data(packet_data, packet_bytes) {
  assert( packet_bytes >= 2 )
  assert( packet_bytes <= MAX_PACKET_BYTES )

  let sequence = (packet_data[1] << 8)
  sequence = sequence + (packet_data[0] & 0xFF)
  sequence = sequence >>> 0

  assert(packet_bytes == ( (sequence * 1023) % ( MAX_PACKET_BYTES - 2 ) ) + 2 )

  for (let i = 2; i < packet_bytes; ++i )
    assert( packet_data[i] == ( (i + sequence) % 256 ) )
}


function test_process_packet_function( context, index, sequence, packet_data, packet_bytes) {
  assert( packet_data )
  assert( packet_bytes > 0 )
  assert( packet_bytes <= MAX_PACKET_BYTES )

  check_packet_data(packet_data, packet_bytes)
  return 1
}



function soak_initialize() {
  console.log( "initializing\n" )

  global_context = { }

  let client_config = {}
  let server_config = {}

  endpoint.reliable_default_config(client_config)
  endpoint.reliable_default_config(server_config)

  client_config.fragment_above = 500
  server_config.fragment_above = 500

  client_config.name = 'client'
  client_config.context = global_context
  client_config.index = 0
  client_config.transmit_packet_function = test_transmit_packet_function
  client_config.process_packet_function = test_process_packet_function

  server_config.name = 'server'
  server_config.context = global_context
  client_config.index = 1
  server_config.transmit_packet_function = test_transmit_packet_function
  server_config.process_packet_function = test_process_packet_function

  global_context.client = endpoint.reliable_endpoint_create( client_config, global_time )
  global_context.server = endpoint.reliable_endpoint_create( server_config, global_time )
}


function soak_iteration() {
  const packet_data = new Uint8Array(MAX_PACKET_BYTES)
  packet_data.fill(0)

  let sequence = global_context.client.sequence

  let packet_bytes = generate_packet_data( sequence, packet_data )

  endpoint.reliable_endpoint_send_packet( global_context.client, packet_data, packet_bytes )

  sequence = global_context.server.sequence
  packet_bytes = generate_packet_data( sequence, packet_data )

  endpoint.reliable_endpoint_send_packet( global_context.server, packet_data, packet_bytes )

  endpoint.reliable_endpoint_update( global_context.client, global_time )
  endpoint.reliable_endpoint_update( global_context.server, global_time )

  global_context.client.num_acks = 0
  global_context.server.num_acks = 0

  global_time += delta_time

  //process.nextTick(soak_iteration)
}


function main() {
  console.log( "[soak]\n" )
  soak_initialize()

  while(true) {
    soak_iteration()
  }
}

let global_context, e, global_time = 100.0, delta_time = 0.1

main()
