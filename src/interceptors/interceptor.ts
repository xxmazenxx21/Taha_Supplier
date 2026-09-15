import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  message: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map((res) => {
        // Allow overriding the default message if the controller returns a 'message' property
        const message = res?.message || 'Success';
        
        // If the controller returns a 'data' property, use it. Otherwise, use the whole response as data.
        // We use hasOwnProperty to ensure we don't accidentally pull prototype properties.
        const hasDataProperty = res && typeof res === 'object' && 'data' in res;
        const data = hasDataProperty ? res.data : res;

        // Special case: if the response only contains a message, set data to null
        const isOnlyMessage = res && typeof res === 'object' && Object.keys(res).length === 1 && 'message' in res;
        const finalData = isOnlyMessage ? null : data;

        return {
          message,
          data: finalData,
        };
      }),
    );
  }
}
