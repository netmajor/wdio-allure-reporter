'use strict'
const expect = require('chai').expect
const reporter = require('./../../../build/reporter')

describe('Suite with step', () => {
    it('First case', () => {
        reporter.runStep('First step', function () {
            return browser
                .url('/index.html')
                .waitForExist('#clickable')
                .click('#clickable')
                .getValue('#result')
                .then((value) => {
                    expect(value).to.be.equal('1')
                })
        })
        reporter.runStep('Second step', function () {
            return browser
                .url('/index.html')
                .waitForExist('#clickable')
                .click('#clickable')
                .getValue('#result')
                .then((value) => {
                    expect(value).to.be.equal('1')
                })
        })
    })

    // it('Second case Async', () => {
    //     reporter.runStepAsync('First step async', async function () {
    //         reporter.runStepAsync('Nested step async', async function () {})
    //     })
    //     reporter.runStepAsync('Second step async', async function () {})
    // })
})
