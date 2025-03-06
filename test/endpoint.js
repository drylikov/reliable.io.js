'use strict'

const test     = require('tap').test
const endpoint = require('../lib/endpoint')


const RELIABLE_MAX_PACKET_HEADER_BYTES = 9
const TEST_ACKS_NUM_ITERATIONS = 256

function create_test_context() {
  return {
    drop: 0,
    sender: null,  // reliable_endpoint_t
    receiver: null // reliable_endpoint_t
  }
}


// @param Object test_context_t context
// @param int index
// @param uint16 sequence
// @param uint8array packet_data
// @param int packet_bytes
function test_transmit_packet_function(context, index, sequence, packet_data, packet_bytes) {
  if (context.drop)
    return

  if (index === 0)
    endpoint.reliable_endpoint_receive_packet(context.receiver, packet_data, packet_bytes)
  else if (index == 1)
    endpoint.reliable_endpoint_receive_packet(context.sender, packet_data, packet_bytes)
}


// @param Object test_context_t context
// @param int index
// @param uint16 sequence
// @param uint8array packet_data
// @param int packet_bytes
function test_process_packet_function(context, index, sequence, packet_data, packet_bytes) {
  return 1
}


// from https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L1626
test('packet_header', function(t) {

  let packet_data = new Uint8Array(RELIABLE_MAX_PACKET_HEADER_BYTES)

  // worst case, sequence and ack are far apart, no packets acked.
  let write_sequence = 10000 // uint16
  let write_ack = 100        // uint16
  let write_ack_bits = 0     // uint32

  let bytes_written = endpoint.reliable_write_packet_header(packet_data, write_sequence, write_ack, write_ack_bits)
  t.equal(bytes_written, RELIABLE_MAX_PACKET_HEADER_BYTES)


  const read_struct = { sequence: 0, ack: 0, ack_bits: 0 }  // uint16, uint16, uint32
  let bytes_read = endpoint.reliable_read_packet_header("test_packet_header", packet_data, bytes_written, read_struct)

  t.equal(bytes_read, bytes_written)

  bytes_read = endpoint.reliable_read_packet_header( "test_packet_header", packet_data, bytes_written, read_struct)
  t.equal(bytes_read, bytes_written)

  t.equal(read_struct.sequence, write_sequence)
  t.equal(read_struct.ack, write_ack )
  t.equal(read_struct.ack_bits, write_ack_bits)


  // rare case. sequence and ack are far apart, significant # of acks are missing

  write_sequence = 10000
  write_ack = 100
  write_ack_bits = 0xFEFEFFFE

  bytes_written = endpoint.reliable_write_packet_header(packet_data, write_sequence, write_ack, write_ack_bits)

  t.equal(bytes_written, 1 + 2 + 2 + 3 )


  read_struct.ack = 0
  read_struct.ack_bits = 0

  bytes_read = endpoint.reliable_read_packet_header("test_packet_header", packet_data, bytes_written, read_struct)

  t.equal(bytes_read, bytes_written)

  t.equal(read_struct.sequence, write_sequence)
  t.equal(read_struct.ack, write_ack )

  t.equal(read_struct.ack_bits, write_ack_bits)


  // common case under packet loss. sequence and ack are close together, some acks are missing

  write_sequence = 200
  write_ack = 100
  write_ack_bits = 0xFFFEFFFF

  bytes_written = endpoint.reliable_write_packet_header( packet_data, write_sequence, write_ack, write_ack_bits )

  t.equal(bytes_written, 1 + 2 + 1 + 1)


  bytes_read = endpoint.reliable_read_packet_header( "test_packet_header", packet_data, bytes_written, read_struct)
  t.equal(bytes_read, bytes_written)
  t.equal(read_struct.sequence, write_sequence)
  t.equal(read_struct.ack, write_ack )
  t.equal(read_struct.ack_bits, write_ack_bits)


  // ideal case. no packet loss.
  write_sequence = 200
  write_ack = 100
  write_ack_bits = 0xFFFFFFFF


  bytes_written = endpoint.reliable_write_packet_header(packet_data, write_sequence, write_ack, write_ack_bits)
  t.equal( bytes_written, 1 + 2 + 1 )


  bytes_read = endpoint.reliable_read_packet_header( "test_packet_header", packet_data, bytes_written, read_struct)

  t.equal(bytes_read, bytes_written)

  t.equal(read_struct.sequence, write_sequence)
  t.equal(read_struct.ack, write_ack )
  t.equal(read_struct.ack_bits, write_ack_bits)

  t.end()
})


// from https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L1718
test('test_acks', function(t) {
  let time = 100.0

  let context = create_test_context()

  let sender_config = {}
  let receiver_config = {}

  endpoint.reliable_default_config(sender_config)
  endpoint.reliable_default_config(receiver_config)

  sender_config.context = context
  sender_config.index = 0
  sender_config.transmit_packet_function = test_transmit_packet_function
  sender_config.process_packet_function = test_process_packet_function

  receiver_config.context = context
  receiver_config.index = 1
  receiver_config.transmit_packet_function = test_transmit_packet_function
  receiver_config.process_packet_function = test_process_packet_function


  context.sender = endpoint.reliable_endpoint_create(sender_config, time)
  context.receiver = endpoint.reliable_endpoint_create(receiver_config, time)

  let delta_time = 0.01

  let i
  for (i = 0; i < TEST_ACKS_NUM_ITERATIONS; ++i ) {
    let dummy_packet = new Uint8Array(8)
    dummy_packet.fill(0)

    endpoint.reliable_endpoint_send_packet(context.sender, dummy_packet, dummy_packet.byteLength)
    endpoint.reliable_endpoint_send_packet(context.receiver, dummy_packet, dummy_packet.byteLength)

    endpoint.reliable_endpoint_update(context.sender, time)
    endpoint.reliable_endpoint_update(context.receiver, time)

    time += delta_time
  }

  let sender_acked_packet = new Uint8Array(TEST_ACKS_NUM_ITERATIONS)
  sender_acked_packet.fill(0)

  let sender_num_acks = context.sender.num_acks
  let sender_acks = context.sender.acks

  for (i = 0; i < sender_num_acks; ++i) {
    if (sender_acks[i] < TEST_ACKS_NUM_ITERATIONS)
      sender_acked_packet[sender_acks[i]] = 1
  }

  for (i = 0; i < TEST_ACKS_NUM_ITERATIONS / 2; ++i)
    t.equal(sender_acked_packet[i], 1)

  let receiver_acked_packet = new Uint8Array(TEST_ACKS_NUM_ITERATIONS)
  receiver_acked_packet.fill(0)


  let receiver_num_acks = context.sender.num_acks
  let receiver_acks = context.sender.acks

  for ( i = 0; i < receiver_num_acks; ++i ) {
    if ( receiver_acks[i] < TEST_ACKS_NUM_ITERATIONS )
      receiver_acked_packet[receiver_acks[i]] = 1
  }

  for ( i = 0; i < TEST_ACKS_NUM_ITERATIONS / 2; ++i )
    t.equal( receiver_acked_packet[i], 1)

  endpoint.reliable_endpoint_destroy(context.sender)
  endpoint.reliable_endpoint_destroy(context.receiver)

  t.end()
})


// from https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L1831
test('acks_packet_loss', function(t) {
  let time = 100.0

  let context = create_test_context()

  let sender_config = {}
  let receiver_config = {}

  endpoint.reliable_default_config(sender_config)
  endpoint.reliable_default_config(receiver_config)

  sender_config.context = context
  sender_config.index = 0
  sender_config.transmit_packet_function = test_transmit_packet_function
  sender_config.process_packet_function = test_process_packet_function

  receiver_config.context = context
  receiver_config.index = 1
  receiver_config.transmit_packet_function = test_transmit_packet_function
  receiver_config.process_packet_function = test_process_packet_function


  context.sender = endpoint.reliable_endpoint_create(sender_config, time)
  context.receiver = endpoint.reliable_endpoint_create(receiver_config, time)

  let delta_time = 0.01

  let i
  for (i = 0; i < TEST_ACKS_NUM_ITERATIONS; ++i ) {
    let dummy_packet = new Uint8Array(8)
    dummy_packet.fill(0)

    context.drop = i % 2

    endpoint.reliable_endpoint_send_packet(context.sender, dummy_packet, dummy_packet.byteLength)
    endpoint.reliable_endpoint_send_packet(context.receiver, dummy_packet, dummy_packet.byteLength)

    endpoint.reliable_endpoint_update(context.sender, time)
    endpoint.reliable_endpoint_update(context.receiver, time)

    time += delta_time
  }

  let sender_acked_packet = new Uint8Array(TEST_ACKS_NUM_ITERATIONS)
  sender_acked_packet.fill(0)

  let sender_num_acks = context.sender.num_acks
  let sender_acks = context.sender.acks

  for (i = 0; i < sender_num_acks; ++i) {
    if (sender_acks[i] < TEST_ACKS_NUM_ITERATIONS)
      sender_acked_packet[sender_acks[i]] = 1
  }

  for (i = 0; i < TEST_ACKS_NUM_ITERATIONS / 2; ++i)
    t.equal(sender_acked_packet[i], (i+1) % 2)

  let receiver_acked_packet = new Uint8Array(TEST_ACKS_NUM_ITERATIONS)
  receiver_acked_packet.fill(0)


  let receiver_num_acks = context.sender.num_acks
  let receiver_acks = context.sender.acks

  for ( i = 0; i < receiver_num_acks; ++i ) {
    if ( receiver_acks[i] < TEST_ACKS_NUM_ITERATIONS )
      receiver_acked_packet[receiver_acks[i]] = 1
  }

  for ( i = 0; i < TEST_ACKS_NUM_ITERATIONS / 2; ++i )
    t.equal( receiver_acked_packet[i], (i+1) % 2)

  endpoint.reliable_endpoint_destroy(context.sender)
  endpoint.reliable_endpoint_destroy(context.receiver)

  t.end()
})


const TEST_MAX_PACKET_BYTES = (4 * 1024)


// from https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L1959
test('packets', function(t) {

  const validate_packet_data = function(packet_data, packet_bytes) {
    t.ok( packet_bytes >= 2 )
    t.ok( packet_bytes <= TEST_MAX_PACKET_BYTES )

    let sequence = (packet_data[1] << 8)
    sequence = sequence + (packet_data[0] & 0xFF)
    sequence = sequence >>> 0

    t.equal(packet_bytes, ( ( sequence * 1023) % ( TEST_MAX_PACKET_BYTES - 2 ) ) + 2 )
    for (let i = 2; i < packet_bytes; ++i )
      t.equal(packet_data[i], (i + sequence) % 256)
  }

  const test_process_packet_function_validate = function(context, index, sequence, packet_data, packet_bytes) {
    t.ok(packet_data)
    t.ok( packet_bytes > 0 )
    t.ok( packet_bytes <= TEST_MAX_PACKET_BYTES )

    validate_packet_data(packet_data, packet_bytes)
    return 1
  }

  const generate_packet_data = function(sequence, packet_data) {
    let packet_bytes = ( ( sequence * 1023 ) % ( TEST_MAX_PACKET_BYTES - 2 ) ) + 2
    t.ok( packet_bytes >= 2 )
    t.ok( packet_bytes <= TEST_MAX_PACKET_BYTES )
    packet_data[0] = sequence & 0xFF
    packet_data[1] = ( (sequence>>8) & 0xFF )
    for (let i = 2; i < packet_bytes; ++i )
      packet_data[i] = (i + sequence) % 256

    return packet_bytes
  }

  let time = 100.0

  let context = create_test_context()

  let sender_config = {}
  let receiver_config = {}

  endpoint.reliable_default_config(sender_config)
  endpoint.reliable_default_config(receiver_config)

  sender_config.fragment_above = 500
  receiver_config.fragment_above = 500

  sender_config.name = 'sender'
  sender_config.context = context
  sender_config.index = 0
  sender_config.transmit_packet_function = test_transmit_packet_function
  sender_config.process_packet_function = test_process_packet_function_validate

  receiver_config.name = 'receiver'
  receiver_config.context = context
  receiver_config.index = 1
  receiver_config.transmit_packet_function = test_transmit_packet_function
  receiver_config.process_packet_function = test_process_packet_function_validate

  context.sender = endpoint.reliable_endpoint_create(sender_config, time)
  context.receiver = endpoint.reliable_endpoint_create(receiver_config, time)

  let delta_time = 0.01

  for (let i = 0; i < 16; ++i) {
    {
      let packet_data = new Uint8Array(TEST_MAX_PACKET_BYTES)
      let sequence = context.sender.sequence
      let packet_bytes = generate_packet_data(sequence, packet_data)
      endpoint.reliable_endpoint_send_packet(context.sender, packet_data, packet_bytes)
    }

    {
      let packet_data2 = new Uint8Array(TEST_MAX_PACKET_BYTES)
      let sequence2 = context.sender.sequence
      let packet_bytes2 = generate_packet_data(sequence2, packet_data2)
      endpoint.reliable_endpoint_send_packet(context.sender, packet_data2, packet_bytes2)
    }

    endpoint.reliable_endpoint_update(context.sender, time)
    endpoint.reliable_endpoint_update(context.receiver, time)

    context.sender.num_acks = 0
    context.receiver.num_acks = 0

    time += delta_time
  }

  endpoint.reliable_endpoint_destroy(context.sender)
  endpoint.reliable_endpoint_destroy(context.receiver)

  t.end()
})
