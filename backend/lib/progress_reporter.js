'use strict';

class ProgressReporter {
    constructor(focused, fullNumber, progressText, finishText) {
        this.focused = focused;
        this.fullnumber = fullNumber;
        this.progressText = progressText;
        this.finishText = finishText;
        this.percent = null;
        this.time = null;
    }

    update(currentNumber) {
        const currentPercent = Math.floor(currentNumber * 100 / this.fullnumber);
        const currentTime = new Date();
        if (this.percent == null || this.time == null || currentPercent == 100 || currentPercent - this.percent > 5 || currentTime - this.time > 30000) {
            this.percent = currentPercent;
            this.time = currentTime;
            this.focused.webContents.send('taskProgress', {
                percent: currentPercent,
                progress: `(${currentNumber}/${this.fullnumber})`,
                text: currentPercent == 100 && this.finishText ? this.finishText : this.progressText
            });
        }
    }
}

module.exports = ProgressReporter; // eslint-disable-line no-undef