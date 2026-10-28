import type {
	GcmCalendarMonth,
	GcmDateRequest,
	GcmMonthInterpolation,
	GcmMonthRequest,
	GcmStartStepRequest,
} from "@/model/climate/gcm/calendar/date/types"
import type { GcmDate } from "@/model/climate/gcm/types"

const CLIMATOLOGY_MONTHS = 14
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const MEAN_GREGORIAN_YEAR = 365.2425

function leap(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function yearStart(year: number): number {
	return (
		365 * year +
		Math.floor((year + 3) / 4) -
		Math.floor((year + 99) / 100) +
		Math.floor((year + 399) / 400)
	)
}

function monthDays({ year, month }: GcmCalendarMonth): number {
	return MONTH_DAYS[month - 1] + (month === 2 && leap(year) ? 1 : 0)
}

function startStep({
	mtspd,
	year,
	month,
	daysPerYear,
	daysPerMonth,
}: GcmStartStepRequest): number {
	if (daysPerYear !== 365)
		return mtspd * (year * daysPerYear + (month - 1) * daysPerMonth)
	let days = yearStart(year)
	for (let at = 1; at < month; at++) days += monthDays({ year, month: at })
	return mtspd * days
}

function date({
	step,
	stepsPerDay,
	daysPerYear,
	stepMinutes,
}: GcmDateRequest): GcmDate {
	if (daysPerYear === 365) {
		const days = Math.trunc(step / stepsPerDay)
		let year = Math.trunc(days / MEAN_GREGORIAN_YEAR)
		while (yearStart(year) > days) year--
		while (yearStart(year + 1) <= days) year++
		let day = days - yearStart(year) + 1
		let month = 1
		while (day > monthDays({ year, month })) {
			day -= monthDays({ year, month })
			month++
		}
		const minutes = Math.trunc(((step % stepsPerDay) * 1440) / stepsPerDay)
		return {
			year,
			month,
			day,
			hour: Math.trunc(minutes / 60),
			minute: minutes % 60,
		}
	}
	const mtspd = Math.trunc((daysPerYear * stepsPerDay) / 360)
	const days = Math.trunc(step / mtspd)
	const dayOfYear = days % 360
	const minutes = Math.trunc((step % mtspd) * Math.round(stepMinutes))
	return {
		year: Math.trunc(days / 360) + 1,
		month: Math.trunc(dayOfYear / 30) + 1,
		day: (dayOfYear % 30) + 1,
		hour: Math.trunc(minutes / 60),
		minute: minutes % 60,
	}
}

function monthInterpolation({
	step,
	stepsPerDay,
	daysPerYear,
	daysPerMonth,
	stepMinutes,
	solarDay,
}: GcmMonthRequest): GcmMonthInterpolation {
	const { year, month, day, hour, minute } = date({
		step,
		stepsPerDay,
		daysPerYear,
		stepMinutes,
	})
	const fractionalDay = day + ((hour * 60 + minute) * 60) / solarDay
	const currentDays =
		daysPerYear === 365 ? monthDays({ year, month }) : daysPerMonth
	const median = 0.5 * (currentDays + 1)
	const neighbour = fractionalDay > median ? month + 1 : month - 1
	const adjacentDays =
		daysPerYear === 365
			? monthDays({ year, month: ((neighbour + 11) % 12) + 1 })
			: daysPerMonth
	return {
		month,
		neighbour,
		weight:
			Math.abs(fractionalDay - median) /
			(median + 0.5 * (adjacentDays + 1) - 1),
	}
}

export const GCM_DATE = {
	CLIMATOLOGY_MONTHS,
	date,
	startStep,
	monthInterpolation,
}
