/*
 * Copyright 2020-2021 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { Request } from "./request.ts";
import type { Msg } from "./types.ts";
import { ErrorCode, NatsError } from "./error.ts";
import type { MsgHdrsImpl } from "./headers.ts";
import { createInbox } from "./protocol.ts";

const noResponders = "503";

export class MuxSubscription {
  baseInbox!: string;
  reqs: Map<string, Request>;

  constructor() {
    this.reqs = new Map<string, Request>();
  }

  size(): number {
    return this.reqs.size;
  }

  init(): string {
    this.baseInbox = `${createInbox()}.`;
    return this.baseInbox;
  }

  add(r: Request) {
    if (!isNaN(r.received)) {
      r.received = 0;
    }
    this.reqs.set(r.token, r);
  }

  get(token: string): Request | undefined {
    return this.reqs.get(token);
  }

  cancel(r: Request): void {
    this.reqs.delete(r.token);
  }

  getToken(m: Msg): string | null {
    const s = m.subject || "";
    if (s.indexOf(this.baseInbox) === 0) {
      return s.substring(this.baseInbox.length);
    }
    return null;
  }

  dispatcher() {
    return (err: NatsError | null, m: Msg) => {
      const token = this.getToken(m);
      if (token) {
        const r = this.get(token);
        if (r) {
          if (err === null && m.headers) {
            const headers = m.headers as MsgHdrsImpl;
            if (headers.hasError) {
              if (headers.status === noResponders) {
                err = NatsError.errorForCode(ErrorCode.NO_RESPONDERS);
              } else {
                err = new NatsError(
                  headers.status,
                  ErrorCode.REQUEST_ERROR,
                );
              }
            }
          }
          r.resolver(err, m);
        }
      }
    };
  }

  close() {
    const err = NatsError.errorForCode(ErrorCode.TIMEOUT);
    this.reqs.forEach((req) => {
      req.resolver(err, {} as Msg);
    });
  }
}
