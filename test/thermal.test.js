import test from 'node:test'
import assert from 'node:assert/strict'
import { ageing, atRating, crossing, simulate, stages } from '../src/public/js/thermal-model.js'

test('thermal ageing doubles with 6 °C for non-upgraded paper; all cooling stages match the reference', () => {
  assert.equal(ageing(98),1)
  const at30 = atRating(stages[2],30)
  assert.equal(at30.topOil,75)
  assert.ok(Math.abs(atRating(stages[2],36).rate / at30.rate - 2) < 1e-10)
  assert.deepEqual(stages.map(stage=>atRating(stage,29.7).hotSpot.toFixed(1)),['81.4','85.7','91.8'])
})

test('first crossing minutes match the 10-hour overload examples at 30 and 38 °C', () => {
  const expected = [
    [30,55,217,null,null], [30,60,61,null,null], [30,65,29,122,null], [30,70,20,55,149],
    [38,55,42,null,null], [38,60,21,115,null], [38,65,14,45,154], [38,70,11,26,68],
  ]
  for (const [ambient, mva, ...minutes] of expected) {
    const {points} = simulate(ambient,mva)
    assert.deepEqual([98,110,120].map(limit=>crossing(points,limit)),minutes)
  }
})

test('simulated intervention carries thermal state forward and reduces accumulated ageing', () => {
  const baseline = simulate(38,65)
  const reduced = simulate(38,65,105)
  const start = reduced.reducedAt
  assert.equal(start,crossing(baseline.points,105))
  assert.deepEqual(baseline.points.slice(0,start+1),reduced.points.slice(0,start+1))
  assert.equal(reduced.points[0].hours,0)
  assert.ok(reduced.points.at(-1).hours < baseline.points.at(-1).hours)
  assert.equal(crossing(reduced.points,110),null)
  assert.equal(crossing(reduced.points,120),null)
})
