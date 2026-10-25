      module mpimod
      use pumamod
      use, intrinsic :: iso_c_binding
      integer, parameter :: MODE_ROOT = 0
      integer, parameter :: MODE_ALL = 1
      integer, parameter :: MODE_SCATTER = 2
      integer, parameter :: OP_SUM = 0
      integer, parameter :: OP_MAX = 1
      integer, parameter :: RBYTES = storage_size(0.0) / 8
      interface
         subroutine shm_init(krank, ksize) bind(c, name='shm_init')
         import :: c_int
         integer(c_int) :: krank, ksize
         end subroutine shm_init
         subroutine shm_barrier() bind(c, name='shm_barrier')
         end subroutine shm_barrier
         subroutine shm_abort() bind(c, name='shm_abort')
         end subroutine shm_abort
         subroutine shm_bcast(buf, kbytes) bind(c, name='shm_bcast')
         import :: c_int
         type(*), dimension(*) :: buf
         integer(c_int), value :: kbytes
         end subroutine shm_bcast
         subroutine shm_blocks(full, local, kchunk, kfull, klocal, klev, &
     &                         kbytes, kmode) bind(c, name='shm_blocks')
         import :: c_int
         type(*), dimension(*) :: full, local
         integer(c_int), value :: kchunk, kfull, klocal, klev, kbytes, kmode
         end subroutine shm_blocks
         subroutine shm_reduce(psend, precv, kcount, kbytes, kop, kmode)  &
     &      bind(c, name='shm_reduce')
         import :: c_int
         type(*), dimension(*) :: psend, precv
         integer(c_int), value :: kcount, kbytes, kop, kmode
         end subroutine shm_reduce
         subroutine shm_reduce_scatter(full, local, kchunk, kfull,        &
     &      klocal, klev, kbytes) bind(c, name='shm_reduce_scatter')
         import :: c_int
         type(*), dimension(*) :: full, local
         integer(c_int), value :: kchunk, kfull, klocal, klev, kbytes
         end subroutine shm_reduce_scatter
      end interface
      end module mpimod

      subroutine mpbci(k)
      use mpimod
      integer :: k(*)
      call shm_bcast(k, storage_size(k(1)) / 8)
      end subroutine mpbci

      subroutine mpbcin(k,n)
      use mpimod
      integer :: k(n)
      call shm_bcast(k, n * storage_size(k(1)) / 8)
      end subroutine mpbcin

      subroutine mpbcr(p)
      use mpimod
      real :: p(*)
      call shm_bcast(p, storage_size(p(1)) / 8)
      end subroutine mpbcr

      subroutine mpbcrn(p,n)
      use mpimod
      real :: p(n)
      call shm_bcast(p, n * storage_size(p(1)) / 8)
      end subroutine mpbcrn

      subroutine mpbcl(l)
      use mpimod
      logical :: l(*)
      call shm_bcast(l, storage_size(l(1)) / 8)
      end subroutine mpbcl

      subroutine mpscin(k,n)
      use mpimod
      integer :: k(*)
      call shm_blocks(k, k, n, n * NPRO, n, 1, storage_size(k(1)) / 8,   &
     &                MODE_SCATTER)
      end subroutine mpscin

      subroutine mpscrn(p,n)
      use mpimod
      real :: p(*)
      call shm_blocks(p, p, n, n * NPRO, n, 1, storage_size(p(1)) / 8,   &
     &                MODE_SCATTER)
      end subroutine mpscrn

      subroutine mpscdn(p,n)
      use mpimod
      real (kind=8) :: p(*)
      call shm_blocks(p, p, n, n * NPRO, n, 1, 8, MODE_SCATTER)
      end subroutine mpscdn

      subroutine mpscgp(pf,pp,klev)
      use mpimod
      real :: pf(NUGP,klev)
      real :: pp(NHOR,klev)
      call shm_blocks(pf, pp, NHOR, NUGP, NHOR, klev, RBYTES, MODE_SCATTER)
      end subroutine mpscgp

      subroutine mpgagp(pf,pp,klev)
      use mpimod
      real :: pf(NUGP,klev)
      real :: pp(NHOR,klev)
      call shm_blocks(pf, pp, NHOR, NUGP, NHOR, klev, RBYTES, MODE_ROOT)
      end subroutine mpgagp

      subroutine mpgallgp(pf,pp,klev)
      use mpimod
      real :: pf(NUGP,klev)
      real :: pp(NHOR,klev)
      call shm_blocks(pf, pp, NHOR, NUGP, NHOR, klev, RBYTES, MODE_ALL)
      end subroutine mpgallgp

      subroutine mpscsp(pf,pp,klev)
      use mpimod
      real :: pf(NESP,klev)
      real :: pp(NSPP,klev)
      call shm_blocks(pf, pp, NSPP, NESP, NSPP, klev, RBYTES, MODE_SCATTER)
      end subroutine mpscsp

      subroutine mpgasp(pf,pp,klev)
      use mpimod
      real :: pf(NESP,klev)
      real :: pp(NSPP,klev)
      call shm_blocks(pf, pp, NSPP, NESP, NSPP, klev, RBYTES, MODE_ROOT)
      end subroutine mpgasp

      subroutine mpgacs(pcs)
      use mpimod
      real :: pcs(NLAT,NLEV)
      call shm_blocks(pcs, pcs, NLPP, NLAT, NLAT, NLEV, RBYTES, MODE_ROOT)
      end subroutine mpgacs

      subroutine mpgallsp(pf,pp,klev)
      use mpimod
      real :: pf(NESP,klev)
      real :: pp(NSPP,klev)
      call shm_blocks(pf, pp, NSPP, NESP, NSPP, klev, RBYTES, MODE_ALL)
      end subroutine mpgallsp

      subroutine mpsum(psp,klev)
      use mpimod
      real :: psp(NESP*klev)
      call shm_reduce(psp, psp, NESP * klev, RBYTES, OP_SUM, MODE_ROOT)
      end subroutine mpsum

      subroutine mpsumsc(psf,psp,klev)
      use mpimod
      real :: psf(NESP,klev)
      real :: psp(NSPP,klev)
      call shm_reduce_scatter(psf, psp, NSPP, NESP, NSPP, klev, RBYTES)
      end subroutine mpsumsc

      subroutine mpsumr(pr,kdim)
      use mpimod
      real :: pr(kdim)
      call shm_reduce(pr, pr, kdim, RBYTES, OP_SUM, MODE_ROOT)
      end subroutine mpsumr

      subroutine mpsumbcr(pr,kdim)
      use mpimod
      real :: pr(kdim)
      call shm_reduce(pr, pr, kdim, RBYTES, OP_SUM, MODE_ALL)
      end subroutine mpsumbcr

      subroutine mpabort(ym)
      use mpimod
      character (len=*) :: ym
      if (mypid == NROOT) then
         open (44,file='Abort_Message')
         write(44,'(A)') trim(ym)
         close(44)
         write(nud,'(/,"Program aborted: ",A,/)') trim(ym)
      endif
      call shm_abort()
      stop 1
      end subroutine mpabort

      subroutine mpstart(kworld)
      use mpimod
      integer(c_int) :: irank, isize
      call shm_init(irank, isize)
      mypid = irank
      nproc = isize
      myworld = 0
      if (nproc /= NPRO) then
         if (mypid == NROOT) then
            write(nud,*)'Compiled for ',NPRO,' nodes'
            write(nud,*)'Running on ',nproc,' nodes'
         endif
         call shm_abort()
         stop 1
      endif
      allocate(ympname(NPRO))
      do jpro = 1 , NPRO
         write(ympname(jpro),'("web worker ",i0)') jpro - 1
      enddo
      end subroutine mpstart

      subroutine mpstop
      use mpimod
      call shm_barrier()
      end subroutine mpstop

      subroutine mpreadgp(ktape,p,kdim,klev)
      use mpimod
      real p(kdim,klev)
      real z(NLON*NLAT,klev)
      z = 0.0
      if (mypid == NROOT) read (ktape) z(:,:)
      if (kdim == NHOR) then
       call mpscgp(z,p,klev)
      else
       if (mypid == NROOT) p = z
      endif
      end subroutine mpreadgp

      subroutine mpwritegp(ktape,p,kdim,klev)
      use mpimod
      real p(kdim,klev)
      real z(NLON*NLAT,klev)
      if (kdim == NHOR) then
       call mpgagp(z,p,klev)
       if (mypid == NROOT) write(ktape) z(1:NLON*NLAT,:)
      else
       if (mypid == NROOT) write(ktape) p(1:NLON*NLAT,:)
      endif
      end subroutine mpwritegp

      subroutine mpwritegph(ktape,p,kdim,klev,ihead)
      use mpimod
      real p(kdim,klev)
      real z(NLON*NLAT,klev)
      real(kind=4) :: zp(kdim,klev)
      real(kind=4) :: zz(NLON*NLAT,klev)
      integer ihead(8)
      if (kdim == NHOR) then
       call mpgagp(z,p,klev)
       if (mypid == NROOT) then
          write(ktape) ihead
          zz(:,:)=z(:,:)
          write(ktape) zz(1:NLON*NLAT,:)
       endif
      else
       if (mypid == NROOT) then
          write(ktape) ihead
          zp(:,:)=p(:,:)
          write(ktape) zp(1:NLON*NLAT,:)
       endif
      endif
      end subroutine mpwritegph

      subroutine mpreadsp(ktape,p,kdim,klev)
      use mpimod
      real p(kdim,klev)
      real z(NESP,klev)
      z = 0.0
      if (mypid == NROOT) read(ktape) ((z(i,j),i=1,NRSP),j=1,klev)
      if (kdim == NSPP) then
         call mpscsp(z,p,klev)
      else
         if (mypid == NROOT) p = z
      endif
      end subroutine mpreadsp

      subroutine mpwritesp(ktape,p,kdim,klev)
      use mpimod
      real p(kdim,klev)
      real z(NESP,klev)
      if (kdim == NSPP) then
         call mpgasp(z,p,klev)
         if (mypid == NROOT) write(ktape) ((z(i,j),i=1,NRSP),j=1,klev)
      else
         if (mypid == NROOT) write(ktape) ((z(i,j),i=1,NRSP),j=1,klev)
      endif
      end subroutine mpwritesp

      subroutine ompi_info(nprocess,npid)
      use mpimod
      integer(c_int) :: irank, isize
      call shm_init(irank, isize)
      nprocess = isize
      npid = irank
      end subroutine ompi_info

      subroutine mpgetsp(yn,p,kdim,klev)
      use mpimod
      character (len=*) :: yn
      real :: p(kdim,klev)
      real :: z(NESP,klev)
      z(:,:) = 0.0
      if (mypid == NROOT) call get_restart_array(yn,z,NRSP,NESP,klev)
      call mpscsp(z,p,klev)
      end subroutine mpgetsp

      subroutine mpgetgp(yn,p,kdim,klev)
      use mpimod
      character (len=*) :: yn
      real :: p(kdim,klev)
      real :: z(NUGP,klev)
      if (mypid == NROOT) call get_restart_array(yn,z,NUGP,NUGP,klev)
      call mpscgp(z,p,klev)
      end subroutine mpgetgp

      subroutine mpputsp(yn,p,kdim,klev)
      use mpimod
      character (len=*) :: yn
      real :: p(kdim,klev)
      real :: z(NESP,klev)
      call mpgasp(z,p,klev)
      if (mypid == NROOT) call put_restart_array(yn,z,NRSP,NESP,klev)
      end subroutine mpputsp

      subroutine mpputgp(yn,p,kdim,klev)
      use mpimod
      character (len=*) :: yn
      real :: p(kdim,klev)
      real :: z(NUGP,klev)
      call mpgagp(z,p,klev)
      if (mypid == NROOT) call put_restart_array(yn,z,NUGP,NUGP,klev)
      end subroutine mpputgp

      subroutine mpsurfgp(yn,p,kdim,klev)
      use mpimod
      character (len=*) :: yn
      real :: p(kdim,klev)
      real :: z(NUGP,klev)
      integer :: iread(1)
      if (mypid == NROOT) call get_surf_array(yn,z,NUGP,klev,iread)
      call mpbci(iread)
      if (iread(1) == 1) call mpscgp(z,p,klev)
      end subroutine mpsurfgp

      subroutine mpmaxval(p,kdim,klev,pmax)
      use mpimod
      real :: p(kdim,klev)
      real :: pmax(1)
      real :: zmax(1)
      zmax(1) = maxval(p(:,:))
      call shm_reduce(zmax, pmax, 1, RBYTES, OP_MAX, MODE_ALL)
      end subroutine mpmaxval

      subroutine mpsumval(p,kdim,klev,psum)
      use mpimod
      real :: p(kdim,klev)
      real :: psum(1)
      real :: zsum(1)
      zsum(1) = sum(p(:,:))
      call shm_reduce(zsum, psum, 1, RBYTES, OP_SUM, MODE_ALL)
      end subroutine mpsumval

      subroutine mrsum(k)
      end subroutine mrsum

      subroutine mrbci(k)
      end subroutine mrbci

      subroutine mrdiff(p,d,n,k)
      real :: p(n)
      real :: d(n)
      end subroutine mrdiff

      subroutine mrdimensions
      end subroutine mrdimensions
