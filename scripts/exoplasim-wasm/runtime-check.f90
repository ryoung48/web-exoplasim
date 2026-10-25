program runtime_check
  implicit none
  real(kind=8), allocatable :: a(:,:), b(:)
  real(kind=8) :: z(8)
  real(kind=4) :: s(8)
  character(len=3) :: c(4)
  integer i
  integer(kind=8) :: bits(8)
  integer(kind=4) :: sbits(8)
  real(kind=4), allocatable :: f(:,:), g(:)
  integer(kind=8) :: k8

  allocate(a(4,3))
  a = 3.5_8
  if (any(a /= 3.5_8)) stop 1
  a = 0.0_8
  a(2:4:2,:) = 7.0_8
  if (count(a == 7.0_8) /= 6) stop 2
  if (count(a == 0.0_8) /= 6) stop 3
  z = [(real(i,8), i=1,8)]
  z(:) = z(3)
  if (any(z /= 3.0_8)) stop 4
  z = -0.0_8
  bits = transfer(z,bits)
  if (any(bits /= -huge(0_8)-1_8)) stop 11
  b = a(:,1)
  if (size(b) /= 4) stop 5
  if (any(b /= [0.0_8,7.0_8,0.0_8,7.0_8])) stop 6
  b = 2.25_8
  b(4:1:-1) = -1.5_8
  if (any(b /= -1.5_8)) stop 7
  a = reshape([(real(i,8), i=1,18)], [6,3])
  a = -2.0_8
  if (size(a) /= 18 .or. any(a /= -2.0_8)) stop 8
  s = 1.25_4
  if (any(s /= 1.25_4)) stop 9
  s = [(real(i,4), i=1,8)]
  s(:) = s(3)
  if (any(s /= 3.0_4)) stop 12
  s = -0.0_4
  sbits = transfer(s,sbits)
  if (any(sbits /= -huge(0_4)-1_4)) stop 13
  allocate(f(5,2))
  f = 0.5_4
  if (any(f /= 0.5_4)) stop 14
  f(1:5:2,:) = 9.0_4
  if (count(f == 9.0_4) /= 6 .or. count(f == 0.5_4) /= 4) stop 15
  f = reshape([(real(i,4), i=1,12)], [4,3])
  f = -4.0_4
  if (size(f) /= 12 .or. any(f /= -4.0_4)) stop 16
  allocate(g(3))
  g = 2.0_4
  g(3:1:-1) = 6.5_4
  if (size(g) /= 3 .or. any(g /= 6.5_4)) stop 17
  k8 = 4611686018427387904_8
  z = k8
  if (any(z /= 4611686018427387904.0_8)) stop 18
  c = 'ok'
  if (any(c /= 'ok ')) stop 10
  print *, 'runtime assignment checks passed'
end program runtime_check
