'use strict'

const reliable_assert  = require('./assert')
const uint16_increment = require('./uint16-increment')


// https://github.com/networkprotocol/reliable.io/blob/4bd1cc77701c80d00d12907e5b5a73aa26b3d29a/reliable.c#L532

const EMPTY = 0xFFFFFFFF // a value of 0xFFFFFFFF indicates an empty entry


/*
Compares two 16 bit sequence numbers and returns true if the first one is greater than the second (considering wrapping).

http://gafferongames.com/networking-for-game-programmers/reliability-and-flow-control

Sequence numbers are 16 bit integers. These numbers wrap around in only 30 minutes.

The trick is to realize that if the current sequence number is already very
high, and the next sequence number that comes in is very low, then you must
have wrapped around. So even though the new sequence number is numerically
lower than the current sequence value, it actually represents a more recent
packet.

For example, lets say we encoded sequence numbers in one byte (bad idea btw :))
then they would wrap around after 255 like this:

    ... 252, 253, 254, 255, 0, 1, 2, 3, ...

To handle this case we need a new function that is aware of the fact that
sequence numbers wrap around to zero after 255, so that 0, 1, 2, 3 are
considered more recent than 255. Otherwise, our reliability system stops
working after you receive packet 255.

This function works by comparing the two numbers and their difference. If their
difference is less than 1/2 the maximum sequence number value, then they must be
close together – so we just check if one is greater than the other, as usual.
However, if they are far apart, their difference will be greater than 1/2 the
max sequence, then we paradoxically consider the sequence number more recent if
it is less than the current sequence number.

This last bit is what handles the wrap around of sequence numbers
transparently, so 0,1,2 are considered more recent than 255.
*/

// returns true if s1 > s2
// both parameters are uint16
function reliable_sequence_greater_than(s1, s2) {
  return ( ( s1 > s2 ) && ( uint16_increment(s1, -s2) <= 32768 ) ) ||
           ( ( s1 < s2 ) && ( uint16_increment(s2, -s1)  > 32768 ) )
}


// returns true if s1 < s2
// both parameters are uint16
function reliable_sequence_less_than(s1, s2) {
  return reliable_sequence_greater_than(s2, s1)
}


// create a new sequence buffer
//
// @param int num_entries how many entries the sequence buffer can hold
// @param Object entry_data_allocator cloned for each entry_data element
// @param Function allocate_function
function reliable_sequence_buffer_create(num_entries, allocate_function) {

  reliable_assert( num_entries > 0)

  // entry_sequence[index] value is used to test if the entry at that index
  // actually corresponds to the sequence number you’re looking for.
  // sequence buffers store uint16 values, but we use a sentinal value of 0xFFFFFFFF
  // to represent an empty entry. Hence the usage of Uint32Array.
  const entry_sequence = new Uint32Array(num_entries)
  entry_sequence.fill(EMPTY)

  const entry_data = []
  for (let i=0; i < num_entries; i++)
    entry_data.push(null)

  const sequence_buffer = {
    num_entries,
    sequence: 0,
    entry_sequence,
    entry_data,
    allocate_function
  }

  return sequence_buffer
}


// get the packet for the given packet sequence number. returns undefined when not set
//
// @param Object sequence_buffer
// @param uint16 sequence
function reliable_sequence_buffer_find(sequence_buffer, sequence) {
  reliable_assert(sequence_buffer)
  let index = sequence % sequence_buffer.num_entries
  return (sequence_buffer.entry_sequence[index] === sequence) ? sequence_buffer.entry_data[index] : undefined
}


// @param Object sequence_buffer
// @param int start_sequence
// @param int finish_sequence
function reliable_sequence_buffer_remove_entries(sequence_buffer,
                                              start_sequence,
                                              finish_sequence) {
  reliable_assert(sequence_buffer)

  // packets arrive out of order and some are lost. Under ridiculously high
  // packet loss (99%) old sequence buffer entries can stick around from
  // before the previous sequence number wrap at 65535 and break the ack
  // logic (leading to false acks and broken reliability where the sender
  // thinks the other side has received something they haven’t…)

  // The solution is to walk between the previous highest insert sequence and
  // the new insert sequence (if it is more recent) and clear those entries
  // in the sequence buffer to 0xFFFFFFFF.

  if (finish_sequence < start_sequence)
    finish_sequence += 65536

  if (finish_sequence - start_sequence < sequence_buffer.num_entries) {
    for (let sequence = start_sequence; sequence <= finish_sequence; ++sequence) {

      let index = sequence % sequence_buffer.num_entries
      sequence_buffer.entry_data[index] = null
      sequence_buffer.entry_sequence[index] = EMPTY
    }
  }
  else {
    for (let i = 0; i < sequence_buffer.num_entries; ++i) {
      equence_buffer.entry_data[i] = null
      sequence_buffer.entry_sequence[i] = EMPTY
    }
  }
}


// @param Object sequence_buffer
// @param uint16 sequence
function reliable_sequence_buffer_remove(sequence_buffer, sequence) {
  reliable_assert(sequence_buffer)
  let index = sequence % sequence_buffer.num_entries
  sequence_buffer.entry_data[index] = null
  sequence_buffer.entry_sequence[index] = EMPTY
}


function reliable_sequence_buffer_test_insert(sequence_buffer, sequence) {
  let next = uint16_increment(sequence_buffer.sequence, -sequence_buffer.num_entries)
  return reliable_sequence_less_than(sequence, next) ? 0 : 1
}


// sets the packet sequence number
// returns the packet for the given sequence number
//
// @param Object sequence_buffer
// @param uint16 sequence
function reliable_sequence_buffer_insert(sequence_buffer, sequence) {
  reliable_assert(sequence_buffer)

  let finish_sequence = uint16_increment(sequence_buffer.sequence, -sequence_buffer.num_entries)

  if (reliable_sequence_less_than(sequence, finish_sequence))
    return

  if (reliable_sequence_greater_than(uint16_increment(sequence), sequence_buffer.sequence)) {
    reliable_sequence_buffer_remove_entries(sequence_buffer, sequence_buffer.sequence, sequence)
    sequence_buffer.sequence = uint16_increment(sequence)
  }

  const index = sequence % sequence_buffer.num_entries
  sequence_buffer.entry_sequence[index] = sequence
  sequence_buffer.entry_data[index] = sequence_buffer.allocate_function()
  return sequence_buffer.entry_data[index]
}


// @param Object sequence_buffer
// @param uint16 sequence
function reliable_sequence_buffer_exists(sequence_buffer, sequence) {
  reliable_assert(sequence_buffer)
  return sequence_buffer.entry_sequence[sequence % sequence_buffer.num_entries] === sequence
}


// @param Object sequence_buffer
// @param Object ack contains 2 fields: uint16 ack and uint32 ack_bits
function reliable_sequence_buffer_generate_ack_bits(sequence_buffer, ack) {
  reliable_assert(sequence_buffer)
  reliable_assert(ack)
  //reliable_assert(ack.ack_bits)
  ack.ack = uint16_increment(sequence_buffer.sequence, -1)
  ack.ack_bits = 0

  let mask = 1  // uint32

  for (let i = 0; i < 32; ++i ) {
    let sequence = ack.ack - i
    if (reliable_sequence_buffer_exists(sequence_buffer, sequence))
      ack.ack_bits |= mask
    mask <<= 1
  }

  // always end bit wise ops with ">>> 0" so the result is interpreted as unsigned.
  ack.ack_bits = ack.ack_bits >>> 0
}


function reliable_sequence_buffer_destroy(sequence_buffer) {
  reliable_assert(sequence_buffer)
  for(let i=0; i < sequence_buffer.entry_data.length; i++)
    sequence_buffer.entry_data[i] = null
}



function reliable_sequence_buffer_reset(sequence_buffer) {
  reliable_assert(sequence_buffer)
  sequence_buffer.sequence = 0
  sequence_buffer.entry_sequence.fill(EMPTY)
  for(let i=0; i < sequence_buffer.entry_data.length; i++)
    sequence_buffer.entry_data[i] = null
}


module.exports = {
  reliable_sequence_less_than,
  reliable_sequence_buffer_create,
  reliable_sequence_buffer_destroy,
  reliable_sequence_buffer_find,
  reliable_sequence_buffer_remove,
  reliable_sequence_buffer_test_insert,
  reliable_sequence_buffer_insert,
  reliable_sequence_buffer_generate_ack_bits,
  reliable_sequence_buffer_reset
}
