interface StreamListener<T> {
  (value: T): void
}

interface StreamDependent<T> {
  updateDependent(val: T): void
  flushDependent(): void
}

// dirty workaround as typescript does not support callable class for now
interface StreamCallable<T> {
  (val: T | undefined): void
  (): T
}

class StreamClass<T> {
  private listeners: StreamListener<T>[] = []
  private dependents: StreamDependent<T>[] = []
  private started: boolean = false
  private value: T | undefined = undefined
  private changed: boolean = false

  private constructor() {}

  static create<T>(init?: T | undefined): Stream<T> {
    const stream$: Stream<T> = function(val: T | undefined) {
      if (typeof val === 'undefined') {
        return stream$.value
      } else {
        stream$.started = true
        stream$.update(val)
        stream$.flush()
      }
    } as Stream<T>
    stream$.started = !(typeof init === 'undefined')
    stream$.value = init
    stream$.changed = false
    stream$.listeners = []
    stream$.dependents = []
    Object.setPrototypeOf(stream$, StreamClass.prototype)
    return stream$
  }

  static combine<T1, V>(
    combiner: (s1: T1) => V,
    streams: [Stream<T1>]
  ): Stream<V>
  static combine<T1, T2, V>(
    combiner: (s1: T1, s2: T2) => V,
    streams: [Stream<T1>, Stream<T2>]
  ): Stream<V>
  static combine<T1, T2, T3, V>(
    combiner: (s1: T1, s2: T2, s3: T3) => V,
    streams: [Stream<T1>, Stream<T2>, Stream<T3>]
  ): Stream<V>
  static combine(
    combiner: (...values: any[]) => any,
    streams: Stream<any>[]
  ): Stream<any> {
    let cached = streams.map(stream$ => stream$())
    const allHasValue = (arr: any[]) =>
      arr.every(elem => typeof elem !== 'undefined')
    const combined$ = Stream(
      allHasValue(cached) ? combiner(...cached) : undefined
    )

    streams.forEach((stream, i) => {
      stream.dependents.push({
        updateDependent(val: any) {
          cached[i] = val
          if (allHasValue(cached)) {
            combined$.update(combiner(...cached))
          }
        },
        flushDependent() {
          combined$.flush()
        },
      })
    })

    return combined$
  }

  static merge<A>(streams: [Stream<A>]): Stream<A>
  static merge<A, B>(streams: [Stream<A>, Stream<B>]): Stream<A | B>
  static merge<A, B, C>(
    streams: [Stream<A>, Stream<B>, Stream<C>]
  ): Stream<A | B | C>
  static merge<V>(streams: Stream<V>[]): Stream<V>
  static merge(streams: Stream<any>[]): Stream<any> {
    const merged$ = Stream()
    streams.forEach(stream$ => {
      stream$.subscribe(val => merged$(val))
    })
    return merged$
  }

  static interval(interval: number) {
    const interval$ = Stream<null>()
    setInterval(() => interval$(null), interval)
    return interval$
  }

  static fromEvent<K extends keyof HTMLElementEventMap>(
    elem: HTMLElement,
    type: K
  ): Stream<HTMLElementEventMap[K]> {
    const event$ = Stream<HTMLElementEventMap[K]>()
    elem.addEventListener(type, event$)
    return event$
  }

  private update(val: T) {
    this.value = val
    this.started = true
    this.changed = true
    this.dependents.forEach(dep => dep.updateDependent(val))
  }

  private flush() {
    if (this.changed) {
      this.changed = false
      if (this.started) {
        this.listeners.forEach(l => l(this.value as T))
      }
      this.dependents.forEach(dep => dep.flushDependent())
    }
  }

  private asStream(): Stream<T> {
    return this as any
  }

  subscribe(listener: StreamListener<T>, emitOnSubscribe?: boolean): this {
    if (emitOnSubscribe && this.started) {
      listener(this.value as T)
    }
    this.listeners.push(listener)
    return this
  }

  log(name: string): this {
    this.subscribe(val =>
      console.log(`[stream] ${name}: ${JSON.stringify(val)}`)
    )
    return this
  }

  map<V>(mapper: (val: T) => V): Stream<V> {
    return Stream.combine<T, V>(mapper, [this.asStream()])
  }

  unique(): Stream<T> {
    let lastValue = this.value
    const unique$ = Stream(lastValue)
    this.subscribe(val => {
      if (val !== lastValue) {
        unique$(val)
        lastValue = val
      }
    })
    return unique$
  }

  filter<V extends T = T>(predict: (val: T) => boolean): Stream<V> {
    const filtered$ = Stream<V>()
    this.subscribe(val => {
      if (predict(val)) {
        filtered$(val as V)
      }
    })
    return filtered$
  }

  delay(delayInMs: number): Stream<T> {
    const delayed$ = Stream<T>()
    this.subscribe(value => {
      setTimeout(() => {
        delayed$(value)
      }, delayInMs)
    })
    return delayed$
  }

  debounce(delay: number): Stream<T> {
    const debounced$ = Stream<T>()
    let timer: any

    this.unique().subscribe(val => {
      clearTimeout(timer)
      timer = setTimeout(function() {
        debounced$(val)
      }, delay)
    })

    return debounced$
  }

  until(condition$: Stream<boolean>): Stream<T> {
    let pending = !condition$()
    const until$ = Stream(pending ? undefined : this.value)

    condition$.subscribe(isOk => {
      if (isOk && pending) {
        pending = false
        until$(this.value)
      }
    })

    this.subscribe(val => {
      if (!condition$()) {
        pending = true
      } else {
        until$(val)
      }
    })

    return until$
  }
}

// dirty workaround as typescript does not support callable class for now
export type Stream<T> = StreamClass<T> & StreamCallable<T>

export const Stream = Object.assign(StreamClass.create, StreamClass)
