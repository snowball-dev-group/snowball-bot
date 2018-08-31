
// created-by: sindresorhus
// license-type: mit
// source: https://github.com/sindresorhus/negative-array/blob/master/index.js
export function negativeArray<T>(input: T[]): T[] {
	if (!Array.isArray(input)) {
		throw new TypeError("Expected an array");
	}

	return new Proxy<T[]>(input, {
		get(target, name, receiver) {
			if (typeof name !== "string") {
				return Reflect.get(target, name, receiver);
			}

			const index = Number(name);

			if (Number.isNaN(index)) {
				return Reflect.get(target, name, receiver);
			}

			return target[index < 0 ? target.length + index : index];
		},
		set(target, name, value, receiver) {
			if (typeof name !== "string") {
				return Reflect.set(target, name, value, receiver);
			}

			const index = Number(name);

			if (Number.isNaN(index)) {
				return Reflect.set(target, name, value, receiver);
			}

			target[index < 0 ? target.length + index : index] = value;

			return true;
		}
	});
}

// created-by: dafri
export function isPromise<T = void>(obj: any): obj is PromiseLike<T> {
	return obj != null && typeof obj === "object" && typeof obj.then === "function";
}

// created-by: matt-johnson
// license-type: unknown
// source: https://stackoverflow.com/a/44118363/3762381
export function intlAcceptsTimezone(timezone: string): boolean {
	if (!Intl || !Intl.DateTimeFormat().resolvedOptions().timeZone) {
		throw new Error("Time zones are not available in this environment");
	}

	try {
		Intl.DateTimeFormat(undefined, { timeZone: timezone });

		return true;
	} catch (err) {
		// intl doesn't accept our timezone

		return false;
	}
}

// created-by: dafri
export function createPropertyIterable<T>(arr: T[], prop: keyof (T)): Iterable<T[keyof (T)]> {
	return {
		[Symbol.iterator]: () => {
			const arrIterator = arr[Symbol.iterator]();

			return {
				next: () => {
					const arrVal = arrIterator.next();

					return {
						done: arrVal.done,
						value: <any> (arrVal.value === undefined ? undefined : arrVal.value[prop])
					};
				}
			};
		}
	};
}

// created-by: dafri
export function getArrayPropertyValues<T>(arr: T[], prop: keyof(T)): Array<T[keyof(T)]> {
	const rArr: Array<T[keyof(T)]> = [];

	for (const val of createPropertyIterable(arr, prop)) {
		rArr.push(val);
	}

	return rArr;
}

const CLASS_REGEXP = /^\s*class\s+/;

/**
 * Checks if passed object is ES6 class
 * @param obj Object to check
 */
export function isClass(obj: any): obj is Function {
	return typeof obj === "function" &&
		typeof obj.toString === "function" &&
		CLASS_REGEXP.test(obj.toString());
}

export default isClass;

