'use strict'

const sb   = require('../lib/sequence-buffer')
const test = require('tap').test


// from https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L1527
const TEST_SEQUENCE_BUFFER_SIZE = 256

const MAX_PACKET_SIZE = 1024


function allocator() {
  return {
    acked: false,
    message: new Uint8Array(MAX_PACKET_SIZE),
    sent_time: 0,
    sequence: 0
  }
}


test('sequence_buffer', function(t) {
  let sequence_buffer = sb.reliable_sequence_buffer_create(TEST_SEQUENCE_BUFFER_SIZE, allocator)

  t.ok(sequence_buffer)
  t.equal(sequence_buffer.sequence, 0)
  t.equal(sequence_buffer.num_entries, TEST_SEQUENCE_BUFFER_SIZE)

  let i

  for ( i = 0; i < TEST_SEQUENCE_BUFFER_SIZE; ++i )
    t.equal( sb.reliable_sequence_buffer_find(sequence_buffer, i), undefined)


  for ( i = 0; i <= TEST_SEQUENCE_BUFFER_SIZE*4; ++i ) {
    let entry = sb.reliable_sequence_buffer_insert(sequence_buffer, i)
    t.ok(entry)
    entry.sequence = i
    t.equal(sequence_buffer.sequence, i + 1 )
  }

  for ( i = 0; i <= TEST_SEQUENCE_BUFFER_SIZE; ++i ) {
    let entry = sb.reliable_sequence_buffer_insert(sequence_buffer, i)
    t.equal(entry, undefined)
  }


  let index = TEST_SEQUENCE_BUFFER_SIZE * 4
  for ( i = 0; i < TEST_SEQUENCE_BUFFER_SIZE; ++i ) {
    let entry = sb.reliable_sequence_buffer_find(sequence_buffer, index)
    t.ok(entry)
    t.equal(entry.sequence, index)
    index--
  }

  sb.reliable_sequence_buffer_reset(sequence_buffer)

  t.ok( sequence_buffer )
  t.equal(sequence_buffer.sequence, 0)
  t.equal(sequence_buffer.num_entries, TEST_SEQUENCE_BUFFER_SIZE )


  for (i = 0; i < TEST_SEQUENCE_BUFFER_SIZE; ++i )
    t.equal(sb.reliable_sequence_buffer_find(sequence_buffer, i), undefined)

  sb.reliable_sequence_buffer_destroy(sequence_buffer)

  t.end()
})


// from https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L1584
test('generate_ack_bits', function(t) {
  let sequence_buffer = sb.reliable_sequence_buffer_create(TEST_SEQUENCE_BUFFER_SIZE, allocator)

  const ack_struct = { ack: 0, ack_bits: 0xFFFFFFFF }

  sb.reliable_sequence_buffer_generate_ack_bits(sequence_buffer, ack_struct)
  t.equal(ack_struct.ack, 0xFFFF)
  t.equal(ack_struct.ack_bits, 0)

  let i;
  for ( i = 0; i <= TEST_SEQUENCE_BUFFER_SIZE; ++i ) {
    sb.reliable_sequence_buffer_insert(sequence_buffer, i)
  }

  sb.reliable_sequence_buffer_generate_ack_bits( sequence_buffer, ack_struct)

  t.equal(ack_struct.ack, TEST_SEQUENCE_BUFFER_SIZE)
  t.equal(ack_struct.ack_bits, 0xFFFFFFFF)

  sb.reliable_sequence_buffer_reset(sequence_buffer)

  const input_acks = [ 1, 5, 9, 11 ]

  for ( i = 0; i < input_acks.length; ++i) {
    sb.reliable_sequence_buffer_insert(sequence_buffer, input_acks[i])
  }

  sb.reliable_sequence_buffer_generate_ack_bits( sequence_buffer, ack_struct)

  t.equal(ack_struct.ack, 11)
  t.equal(ack_struct.ack_bits, ( 1 | (1<<(11-9)) | (1<<(11-5)) | (1<<(11-1)) ) )

  sb.reliable_sequence_buffer_destroy(sequence_buffer)

  t.end()
})


test('create', function(t) {
  const num_entries = 256
  const sequence_buffer = sb.reliable_sequence_buffer_create(num_entries, allocator)

  t.ok(sequence_buffer)
  t.equal(sequence_buffer.num_entries, num_entries)
  t.equal(sequence_buffer.sequence, 0)
  t.equal(sequence_buffer.entry_data.length, num_entries)
  t.equal(sequence_buffer.entry_sequence.length, num_entries)
  t.end()
})


test('insert', function(t) {
  const num_entries = 256
  const s = sb.reliable_sequence_buffer_create(num_entries, allocator)

  let sequence = 14
  let packet = sb.reliable_sequence_buffer_insert(s, sequence)

  t.equal(packet.acked, false)
  t.equal(s.entry_sequence[14], 14)

  // index number wraps around 1024
  sequence = 1024
  sb.reliable_sequence_buffer_insert(s, sequence)
  t.equal(s.entry_sequence[0], 1024)

  t.end()
})


test('remove', function(t) {
  const num_entries = 256
  const s = sb.reliable_sequence_buffer_create(num_entries, allocator)

  let sequence = 60
  sb.reliable_sequence_buffer_insert(s, sequence)

  t.equal(s.entry_sequence[60], 60)

  sb.reliable_sequence_buffer_remove(s, 60)

  t.equal(s.entry_sequence[60], 0xFFFFFFFF)

  t.end()
})


test('find', function(t) {
  const num_entries = 256
  const s = sb.reliable_sequence_buffer_create(num_entries, allocator)

  let sequence = 100

  t.equal(sb.reliable_sequence_buffer_find(s, sequence), undefined, 'packet sequence that has not been set should return undefined')

  sequence = 200
  let packet = sb.reliable_sequence_buffer_insert(s, sequence)
  packet.acked = true

  t.equal(sb.reliable_sequence_buffer_find(s, 200).acked, true)
  t.end()
})


test('generate ack bits', function(t) {

  const num_entries = 256
  const s = sb.reliable_sequence_buffer_create(num_entries, allocator)


  sb.reliable_sequence_buffer_insert(s, 200).acked = true

  let ack_struct = { ack: 200, ack_bits: 0 }
  sb.reliable_sequence_buffer_generate_ack_bits(s, ack_struct)

  t.equal(ack_struct.ack_bits, 0b01)

  sb.reliable_sequence_buffer_insert(s, 198).acked = true


  ack_struct = { ack: 200, ack_bits: 0 }
  sb.reliable_sequence_buffer_generate_ack_bits(s, ack_struct)

  t.equal(ack_struct.ack_bits, 0b101)


  // detect when all 32 sequence numbers are acked
  for(let i =0; i < 32; i++)
    sb.reliable_sequence_buffer_insert(s, 200 - i).acked = true

  ack_struct = { ack: 200, ack_bits: 0 }
  sb.reliable_sequence_buffer_generate_ack_bits(s, ack_struct)

  t.equal(ack_struct.ack_bits, 0xFFFFFFFF)

  t.end()
})
