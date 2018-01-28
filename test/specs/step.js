import { expect } from 'chai'
import { clean, run } from '../helper'

describe('Step', () => {
    beforeEach(clean)

    it.only('should detect step in test cases', () => {
        return run(['step']).then((results) => {
            expect(results).to.have.lengthOf(1)
            const result = results[0]

            expect(result('ns2\\:test-suite > name').text()).to.be.equal('Suite with step')
            expect(result('test-case > name').eq(0).text()).to.be.equal('First case')
            expect(result('test-case label[name="feature"]').eq(0).attr('value')).to.be.equal('Test feature')
        })
    })
})
