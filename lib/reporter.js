import process from 'process'
import events from 'events'
import Allure from 'allure-js-commons'
import Step from 'allure-js-commons/beans/step'

function isEmpty (object) {
    return !object || Object.keys(object).length === 0
}

const LOGGING_HOOKS = ['"before all" hook', '"after all" hook']

/**
 * Initialize a new `Allure` test reporter.
 *
 * @param {Runner} runner
 * @api public
 */
class AllureReporter extends events.EventEmitter {
    constructor (baseReporter, config, options = {}) {
        super()

        this.baseReporter = baseReporter
        this.config = config
        this.options = options
        this.allures = {}
        this.postponedSteps = {}

        const { epilogue } = this.baseReporter

        // Hook events
        this.on('hook:start', ::this.hookStart)
        this.on('hook:end', ::this.hookEnd)

        // Test framework events
        this.on('suite:start', ::this.suiteStart)
        this.on('suite:end', ::this.suiteEnd)
        this.on('test:start', ::this.testStart)
        this.on('test:pass', ::this.testPass)
        this.on('test:fail', ::this.testFail)
        this.on('test:pending', ::this.testPending)

        // Runner events (webdriver)
        this.on('runner:command', ::this.runnerCommand)
        this.on('runner:result', ::this.runnerResult)
        this.on('end', () => {
            epilogue.call(baseReporter)
        })

        // Allure events
        this.on('allure:feature', ::this.allureFeature)
        this.on('allure:addEnvironment', ::this.allureAddEnvironment)
        this.on('allure:addDescription', ::this.allureAddDescription)
        this.on('allure:attachment', ::this.allureAttachment)
        this.on('allure:story', ::this.allureStory)
        this.on('allure:startstep', ::this.allureStartstep)
        this.on('allure:endstep', ::this.allureEndstep)
    }

    suiteStart (suite) {
        const allure = this.getAllure(suite.cid)
        const currentSuite = allure.getCurrentSuite()
        const prefix = currentSuite ? currentSuite.name + ' ' : ''
        allure.startSuite(prefix + suite.title)
    }

    suiteEnd (suite) {
        this.getAllure(suite.cid).endSuite()
    }

    testStart (test) {
        const allure = this.getAllure(test.cid)
        allure.startCase(test.title)

        const currentTest = allure.getCurrentTest()
        currentTest.addParameter('environment-variable', 'capabilities', JSON.stringify(test.runner[test.cid]))
        currentTest.addParameter('environment-variable', 'spec files', JSON.stringify(test.specs))

        if (test.featureName && test.scenarioName) {
            currentTest.addLabel('feature', test.featureName)
            currentTest.addLabel('story', test.scenarioName)
        }

        // Analytics labels More: https://github.com/allure-framework/allure2/blob/master/Analytics.md
        currentTest.addLabel('language', 'javascript')
        currentTest.addLabel('framework', 'wdio')
    }

    testPass (test) {
        this.getAllure(test.cid).endCase('passed')
    }

    testFail (test) {
        const allure = this.getAllure(test.cid)
        const status = test.err.type === 'AssertionError' ? 'failed' : 'broken'

        if (!allure.getCurrentTest()) {
            allure.startCase(test.title)
        } else {
            allure.getCurrentTest().name = test.title
        }

        while (allure.getCurrentSuite().currentStep instanceof Step) {
            allure.endStep(status)
        }
        this.postponedSteps[test.cid] = []

        allure.endCase(status, test.err)
    }

    testPending (test) {
        this.getAllure(test.cid).pendingCase(test.title)
    }

    runnerCommand (command) {
        console.log('runnerCommand', command)
        const allure = this.getAllure(command.cid)

        if (!this.isAnyTestRunning(allure)) {
            return
        }

        allure.startStep(`${command.method} ${command.uri.path}`)

        if (!isEmpty(command.data)) {
            this.dumpJSON(allure, 'Request', command.data)
        }
    }

    runnerResult (command) {
        console.log('runnerResult', command)

        const allure = this.getAllure(command.cid)

        if (!this.isAnyTestRunning(allure)) {
            return
        }

        if (command.requestOptions.uri.path.match(/\/session\/[^/]*\/screenshot/) && command.body.value) {
            allure.addAttachment('Screenshot', Buffer.from(command.body.value, 'base64'))
        } else if (command.body) {
            this.dumpJSON(allure, 'Response', command.body)
        }

        allure.endStep('passed')
    }

    hookStart (hook) {
        const allure = this.getAllure(hook.cid)

        if (!allure.getCurrentSuite() || LOGGING_HOOKS.indexOf(hook.title) === -1) {
            return
        }

        allure.startCase(hook.title)
    }

    hookEnd (hook) {
        const allure = this.getAllure(hook.cid)

        if (!allure.getCurrentSuite() || LOGGING_HOOKS.indexOf(hook.title) === -1) {
            return
        }

        allure.endCase('passed')

        if (allure.getCurrentTest().steps.length === 0) {
            allure.getCurrentSuite().testcases.pop()
        }
        this.postponedSteps[hook.cid] = []
    }

    allureFeature ({ cid, featureName }) {
        const allure = this.getAllure(cid)
        const test = allure.getCurrentTest()
        test.addLabel('feature', featureName)
    }

    allureAddEnvironment ({ cid, name, value }) {
        const allure = this.getAllure(cid)
        const test = allure.getCurrentTest()
        test.addParameter('environment-variable', name, value)
    }

    allureAddDescription ({ cid, description, type }) {
        const allure = this.getAllure(cid)
        const test = allure.getCurrentTest()
        test.setDescription(description, type)
    }

    allureAttachment ({cid, name, content, type}) {
        if (content == null) {
            return
        }

        var allure = null
        allure = this.getAllure(cid)

        if (allure == null) {
            return
        }

        if (type === 'application/json') {
            this.dumpJSON(allure, name, content)
        } else {
            allure.addAttachment(name, content, type)
        }
    }

    allureStory ({ cid, storyName }) {
        const test = this.getAllure(cid).getCurrentTest()
        test.addLabel('story', storyName)
    }

    allureStartstep ({ cid, label }) {
        const allure = this.getAllure(cid)

        allure.startStep(label)
        console.log('start ' + label)
    }

    allureEndstep ({ cid, status, label }) {
        console.log('allureEndstep ', label)
        this.postponeOrEndStep(cid, label, status)
        // const allure = this.getAllure(cid)

        // allure.endStep(status)
    }

    static feature (featureName) {
        AllureReporter.tellReporter('allure:feature', { featureName })
    }

    static addEnvironment (name, value) {
        AllureReporter.tellReporter('allure:addEnvironment', { name, value })
    }

    static addDescription (description, type) {
        AllureReporter.tellReporter('allure:addDescription', { description, type })
    }

    static createAttachment (name, content, type = 'text/plain') {
        AllureReporter.tellReporter('allure:attachment', {name, content, type})
    }

    static story (storyName) {
        AllureReporter.tellReporter('allure:story', { storyName })
    }

    // startStep (label) {
    //     AllureReporter.tellReporter('allure:startstep', { label })
    // }

    // endStep (label, success = true) {
    //     AllureReporter.tellReporter('allure:endstep', { status: success ? 'passed' : 'broken', label })
    // }

    static tellReporter (event, msg = {}) {
        process.send({ event, ...msg })
    }

    static runStep (label, stepFn) {
        console.log('start function ' + label, stepFn)
        AllureReporter.tellReporter('allure:startstep', { label })
        try {
            const result = stepFn()
            console.log('end function ' + label, stepFn)
            AllureReporter.tellReporter('allure:endstep', { status: 'passed', label })
            return result
        } catch (e) {
            AllureReporter.tellReporter('allure:endstep', { status: 'broken', label })
            throw e
        }
    }

    static async runStepAsync (label, stepFn) {
        console.log('start function ' + label, stepFn)
        AllureReporter.tellReporter('allure:startstep', { label })
        try {
            const result = await stepFn()
            console.log('end function ' + label, stepFn)
            AllureReporter.tellReporter('allure:endstep', { status: 'passed', label })
            return result
        } catch (e) {
            AllureReporter.tellReporter('allure:endstep', { status: 'broken', label })
            throw e
        }
    }

    postponeOrEndStep (cid, name, status) {
        const allure = this.getAllure(cid)
        const suite = allure.getCurrentSuite() || {}
        let step = suite.currentStep
        let postponed = this.postponedSteps[cid].slice()

        // In this loop:
        // We search for the expected step by name in the stack of active steps.
        // If it is found, that means we must either end all of the steps on the
        // stack up to that point, or we should postpone it.
        // If it is NOT found, that means we should ignore it; the step is not
        // active and does not need to be ended.
        let stepsToEnd = 0
        let shouldPostpone = false
        while (step instanceof Step) {
            stepsToEnd++
            if (step.name === name) {
                if (!shouldPostpone) {
                    for (let stepCount = 0; stepCount < stepsToEnd; stepCount++) {
                        allure.endStep(status)
                        console.log('postponeOrEndStep ', name)
                    }
                    this.postponedSteps[cid] = postponed
                } else {
                    this.postponedSteps[cid].push(name)
                }
                break
            }
            // We postpone ending the step if doing so would end a step which
            // we haven't yet postponed.
            const postponedIndex = postponed.indexOf(step.name)
            if (postponedIndex < 0) {
                shouldPostpone = true
            } else {
                postponed.splice(postponedIndex, 1)
            }
            step = step.parent
        }
    }

    getAllure (cid) {
        if (this.allures[cid]) {
            return this.allures[cid]
        }

        const allure = new Allure()
        allure.setOptions({ targetDir: this.options.outputDir || 'allure-results' })
        this.postponedSteps[cid] = []
        this.allures[cid] = allure
        return this.allures[cid]
    }

    isAnyTestRunning (allure) {
        return allure.getCurrentSuite() && allure.getCurrentTest()
    }

    dumpJSON (allure, name, json) {
        allure.addAttachment(name, JSON.stringify(json, null, '    '), 'application/json')
    }
}

export default AllureReporter
